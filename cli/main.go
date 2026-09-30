package main

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"time"
)

const (
	extensionID = "zero.vscode-command-cli"
	executePath = "/v1/execute"
	resultPath  = "/v1/result/"
)

type executeRequest struct {
	Version int          `json:"version"`
	Command string       `json:"command"`
	Args    []string     `json:"args"`
	Reply   *replyTarget `json:"reply,omitempty"`
}

type replyTarget struct {
	RequestID string `json:"requestId"`
	Token     string `json:"token"`
	URL       string `json:"url"`
}

type commandReply struct {
	Version   int             `json:"version"`
	RequestID string          `json:"requestId"`
	OK        bool            `json:"ok"`
	Result    json.RawMessage `json:"result,omitempty"`
	Error     string          `json:"error,omitempty"`
}

type resultEnvelope struct {
	CLI    resultLayer  `json:"cli"`
	VSCode *resultLayer `json:"vscode,omitempty"`
}

type resultLayer struct {
	OK     bool            `json:"ok"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  *resultError    `json:"error,omitempty"`
}

type resultError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type callbackServer struct {
	listener net.Listener
	server   *http.Server
	reply    replyTarget
	result   chan commandReply
}

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

func run(args []string, stdout io.Writer, stderr io.Writer) int {
	flags := flag.NewFlagSet("code-cli", flag.ContinueOnError)
	flags.SetOutput(stderr)
	waitForResult := flags.Bool("wait", false, "wait for and print the command result as JSON")
	timeout := flags.Duration("timeout", 0, "maximum time to wait when --wait is set; zero waits indefinitely")
	uriScheme := flags.String("uri-scheme", defaultURIScheme(), "VS Code URI scheme")
	flags.Usage = func() {
		fmt.Fprintln(stderr, "Usage: code-cli [--wait] [--timeout 15s] [--uri-scheme vscode] <vscode.commandId> [arg...]")
	}

	if err := flags.Parse(args); err != nil {
		return 2
	}

	commandArgs := flags.Args()
	if len(commandArgs) == 0 {
		flags.Usage()
		return 2
	}

	request := executeRequest{
		Version: 1,
		Command: commandArgs[0],
		Args:    commandArgs[1:],
	}

	var callback *callbackServer
	if *waitForResult {
		if *timeout < 0 {
			writeResult(stdout, cliFailure("invalid_timeout", "--timeout must not be negative."))
			return 2
		}

		var err error
		callback, err = newCallbackServer()
		if err != nil {
			writeResult(stdout, cliFailure("callback_start_failed", err.Error()))
			return 1
		}
		defer callback.close()
		request.Reply = &callback.reply
	}

	uri, err := makeURI(*uriScheme, request)
	if err != nil {
		if callback != nil {
			writeResult(stdout, cliFailure("invalid_request", err.Error()))
		} else {
			fmt.Fprintf(stderr, "Error: build URI: %v\n", err)
		}
		return 2
	}

	if err := openURI(uri); err != nil {
		if callback != nil {
			writeResult(stdout, cliFailure("open_uri_failed", err.Error()))
		} else {
			fmt.Fprintf(stderr, "Error: open VS Code URI: %v\n", err)
		}
		return 1
	}

	if callback == nil {
		return 0
	}

	ctx := context.Background()
	cancel := func() {}
	if *timeout > 0 {
		ctx, cancel = context.WithTimeout(ctx, *timeout)
	}
	defer cancel()
	reply, err := callback.wait(ctx)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			writeResult(stdout, cliFailure("timeout", fmt.Sprintf("Timed out after %s.", *timeout)))
		} else {
			writeResult(stdout, cliFailure("callback_failed", err.Error()))
		}
		return 1
	}

	if err := writeResult(stdout, resultFromReply(reply)); err != nil {
		fmt.Fprintf(stderr, "Error: write command result: %v\n", err)
		return 1
	}
	if !reply.OK {
		return 1
	}

	return 0
}

func writeResult(writer io.Writer, result resultEnvelope) error {
	return json.NewEncoder(writer).Encode(result)
}

func cliFailure(code string, message string) resultEnvelope {
	return resultEnvelope{
		CLI: resultLayer{
			OK:    false,
			Error: &resultError{Code: code, Message: message},
		},
	}
}

func resultFromReply(reply commandReply) resultEnvelope {
	if !reply.OK {
		return resultEnvelope{
			CLI: resultLayer{OK: true},
			VSCode: &resultLayer{
				OK:    false,
				Error: &resultError{Code: "command_failed", Message: reply.Error},
			},
		}
	}

	return resultEnvelope{
		CLI: resultLayer{OK: true},
		VSCode: &resultLayer{
			OK:     true,
			Result: reply.Result,
		},
	}
}

func defaultURIScheme() string {
	if scheme := os.Getenv("VSCODE_COMMAND_CLI_URI_SCHEME"); scheme != "" {
		return scheme
	}
	return "vscode"
}

func makeURI(scheme string, request executeRequest) (string, error) {
	if !isURIScheme(scheme) {
		return "", errors.New("URI scheme is invalid")
	}

	payload, err := json.Marshal(request)
	if err != nil {
		return "", err
	}

	return fmt.Sprintf("%s://%s%s?p=%s", scheme, extensionID, executePath, base64.RawURLEncoding.EncodeToString(payload)), nil
}

func isURIScheme(value string) bool {
	if value == "" || !isASCIIAlpha(value[0]) {
		return false
	}

	for _, character := range value[1:] {
		if !isASCIIAlpha(byte(character)) && (character < '0' || character > '9') && character != '+' && character != '-' && character != '.' {
			return false
		}
	}

	return true
}

func isASCIIAlpha(value byte) bool {
	return value >= 'a' && value <= 'z' || value >= 'A' && value <= 'Z'
}

func newCallbackServer() (*callbackServer, error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}

	requestID, err := randomToken()
	if err != nil {
		listener.Close()
		return nil, err
	}
	token, err := randomToken()
	if err != nil {
		listener.Close()
		return nil, err
	}

	callback := &callbackServer{
		listener: listener,
		reply: replyTarget{
			RequestID: requestID,
			Token:     token,
			URL:       fmt.Sprintf("http://127.0.0.1:%d%s%s", listener.Addr().(*net.TCPAddr).Port, resultPath, requestID),
		},
		result: make(chan commandReply, 1),
	}
	callback.server = &http.Server{Handler: http.HandlerFunc(callback.handleReply)}
	go func() {
		if err := callback.server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			return
		}
	}()

	return callback, nil
}

func (callback *callbackServer) handleReply(response http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost || request.URL.Path != resultPath+callback.reply.RequestID {
		http.NotFound(response, request)
		return
	}

	if subtle.ConstantTimeCompare([]byte(request.Header.Get("X-VSCode-Command-CLI-Token")), []byte(callback.reply.Token)) != 1 {
		http.Error(response, "invalid callback token", http.StatusForbidden)
		return
	}

	defer request.Body.Close()
	decoder := json.NewDecoder(io.LimitReader(request.Body, 1<<20))
	var reply commandReply
	if err := decoder.Decode(&reply); err != nil {
		http.Error(response, "invalid JSON callback", http.StatusBadRequest)
		return
	}

	if reply.Version != 1 || reply.RequestID != callback.reply.RequestID {
		http.Error(response, "invalid callback payload", http.StatusBadRequest)
		return
	}

	select {
	case callback.result <- reply:
		response.WriteHeader(http.StatusNoContent)
	default:
		http.Error(response, "callback result already received", http.StatusConflict)
	}
}

func (callback *callbackServer) wait(ctx context.Context) (commandReply, error) {
	select {
	case reply := <-callback.result:
		return reply, nil
	case <-ctx.Done():
		return commandReply{}, ctx.Err()
	}
}

func (callback *callbackServer) close() {
	shutdownContext, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	_ = callback.server.Shutdown(shutdownContext)
}

func randomToken() (string, error) {
	buffer := make([]byte, 24)
	if _, err := rand.Read(buffer); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buffer), nil
}

func openURI(uri string) error {
	var command *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		command = exec.Command("cmd.exe", "/c", "start", "", uri)
	case "darwin":
		command = exec.Command("open", uri)
	default:
		command = exec.Command("xdg-open", uri)
	}
	command.Stdout = io.Discard
	command.Stderr = io.Discard
	return command.Start()
}
