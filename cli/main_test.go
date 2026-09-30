package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestRunVersionPrintsCLIOnly(t *testing.T) {
	previousVersion := cliVersion
	cliVersion = "1.2.3"
	defer func() { cliVersion = previousVersion }()

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	if exitCode := run([]string{"--version"}, &stdout, &stderr); exitCode != 0 {
		t.Fatalf("run returned %d: %s", exitCode, stderr.String())
	}
	if got := stdout.String(); got != "code-cli 1.2.3\n" {
		t.Fatalf("unexpected version output: %q", got)
	}
}

func TestVersionRequestContainsAnEmptyArgsArray(t *testing.T) {
	uri, err := makeURI("vscode", executeRequest{
		Version: 1,
		Command: versionCommand,
		Args:    []string{},
	})
	if err != nil {
		t.Fatalf("make URI: %v", err)
	}

	parsedURI, err := url.Parse(uri)
	if err != nil {
		t.Fatalf("parse URI: %v", err)
	}
	payload, err := base64.RawURLEncoding.DecodeString(parsedURI.Query().Get("p"))
	if err != nil {
		t.Fatalf("decode payload: %v", err)
	}
	var decoded map[string]json.RawMessage
	if err := json.Unmarshal(payload, &decoded); err != nil {
		t.Fatalf("decode payload JSON: %v", err)
	}
	if got := string(decoded["args"]); got != "[]" {
		t.Fatalf("version request args = %s, want []", got)
	}
}

func TestMakeURIEncodesRequest(t *testing.T) {
	uri, err := makeURI("vscode", executeRequest{
		Version: 1,
		Command: "myPlugin.handleMessage",
		Args:    []string{"json:{\"message\":\"中文\"}"},
		Reply:   &replyTarget{RequestID: "abcdefghijklmnop", Token: "abcdefghijklmnop", URL: "http://127.0.0.1:3000/v1/result/abcdefghijklmnop"},
	})
	if err != nil {
		t.Fatalf("makeURI returned an error: %v", err)
	}

	parsedURI, err := url.Parse(uri)
	if err != nil {
		t.Fatalf("parse URI: %v", err)
	}
	if parsedURI.Scheme != "vscode" || parsedURI.Host != extensionID || parsedURI.Path != executePath {
		t.Fatalf("unexpected URI: %s", uri)
	}

	payload, err := base64.RawURLEncoding.DecodeString(parsedURI.Query().Get("p"))
	if err != nil {
		t.Fatalf("decode payload: %v", err)
	}

	var decoded executeRequest
	if err := json.Unmarshal(payload, &decoded); err != nil {
		t.Fatalf("decode JSON payload: %v", err)
	}
	if decoded.Command != "myPlugin.handleMessage" || len(decoded.Args) != 1 || decoded.Args[0] != "json:{\"message\":\"中文\"}" || decoded.Reply == nil {
		t.Fatalf("unexpected decoded request: %#v", decoded)
	}
}

func TestCallbackServerAcceptsAuthorizedReply(t *testing.T) {
	callback, err := newCallbackServer()
	if err != nil {
		t.Fatalf("start callback server: %v", err)
	}
	defer callback.close()

	body := strings.NewReader(`{"version":1,"requestId":"` + callback.reply.RequestID + `","ok":true,"result":{"value":"done"}}`)
	request, err := http.NewRequest(http.MethodPost, callback.reply.URL, body)
	if err != nil {
		t.Fatalf("create callback request: %v", err)
	}
	request.Header.Set("X-VSCode-Command-CLI-Token", callback.reply.Token)
	request.Header.Set("Content-Type", "application/json")

	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("send callback request: %v", err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusNoContent {
		t.Fatalf("unexpected callback status: %d", response.StatusCode)
	}

	context, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	reply, err := callback.wait(context)
	if err != nil {
		t.Fatalf("wait for callback: %v", err)
	}
	if !reply.OK || reply.RequestID != callback.reply.RequestID {
		t.Fatalf("unexpected callback reply: %#v", reply)
	}
}

func TestResultFromReplyPreservesFalseResult(t *testing.T) {
	result, err := json.Marshal(resultFromReply(commandReply{
		OK:     true,
		Result: json.RawMessage(`false`),
	}))
	if err != nil {
		t.Fatalf("marshal result envelope: %v", err)
	}

	if !strings.Contains(string(result), `"vscode":{"ok":true,"result":false}`) {
		t.Fatalf("unexpected result envelope: %s", result)
	}
}

func TestResultFromReplyDoesNotCreateVSCodeLayerForCLIFailure(t *testing.T) {
	result, err := json.Marshal(cliFailure("timeout", "Timed out after 15s."))
	if err != nil {
		t.Fatalf("marshal CLI failure: %v", err)
	}

	if strings.Contains(string(result), `"vscode"`) {
		t.Fatalf("CLI failure unexpectedly included a VS Code layer: %s", result)
	}
}

func TestVersionResultIncludesCLIVSCodeAndExtensionVersions(t *testing.T) {
	previousVersion := cliVersion
	cliVersion = "1.2.3"
	defer func() { cliVersion = previousVersion }()

	result, err := json.Marshal(versionResultFromReply(commandReply{
		OK:     true,
		Result: json.RawMessage(`{"extensionVersion":"4.5.6","vscodeVersion":"1.99.0"}`),
	}))
	if err != nil {
		t.Fatalf("marshal version result: %v", err)
	}

	want := `{"cli":{"ok":true,"version":"1.2.3"},"vscode":{"ok":true,"version":"1.99.0","extensionVersion":"4.5.6"}}`
	if got := string(result); got != want {
		t.Fatalf("unexpected version result:\nwant %s\n got %s", want, got)
	}
}
