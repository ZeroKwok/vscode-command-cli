package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestMakeURIEncodesRequest(t *testing.T) {
	uri, err := makeURI("vscode", executeRequest{
		Version: 1,
		Command: "myPlugin.handleMessage",
		Args:    []string{"json:{\"message\":\"中文\"}"},
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
	if decoded.Command != "myPlugin.handleMessage" || len(decoded.Args) != 1 || decoded.Args[0] != "json:{\"message\":\"中文\"}" {
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
