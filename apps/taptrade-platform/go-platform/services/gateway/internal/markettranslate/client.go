package markettranslate

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type OpenAICompatibleClient struct {
	endpoint   string
	apiKey     string
	model      string
	provider   string
	httpClient *http.Client
}

func NewOpenAICompatibleClient(cfg Config) *OpenAICompatibleClient {
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = 45 * time.Second
	}
	return &OpenAICompatibleClient{
		endpoint: strings.TrimRight(cfg.Endpoint, "/"),
		apiKey:   strings.TrimSpace(cfg.APIKey),
		model:    strings.TrimSpace(cfg.Model),
		provider: strings.TrimSpace(cfg.Provider),
		httpClient: &http.Client{
			Timeout: timeout,
		},
	}
}

func (c *OpenAICompatibleClient) Translate(ctx context.Context, req TranslationRequest) (map[string]Translation, TranslationMeta, error) {
	meta := TranslationMeta{
		Provider: c.provider,
		Model:    c.model,
		Prompt:   PromptVersion,
	}
	if c.endpoint == "" {
		return nil, meta, errors.New("translation endpoint is not configured")
	}
	if c.apiKey == "" {
		return nil, meta, errors.New("translation API key is not configured")
	}
	if c.model == "" {
		return nil, meta, errors.New("translation model is not configured")
	}
	if len(req.Locales) == 0 {
		return map[string]Translation{}, meta, nil
	}

	body := openAIChatRequest{
		Model:       c.model,
		Temperature: ptrFloat(0.1),
		ResponseFormat: map[string]string{
			"type": "json_object",
		},
		Messages: []openAIMessage{
			{Role: "system", Content: systemPrompt(req.Locales)},
			{Role: "user", Content: userPrompt(req)},
		},
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return nil, meta, err
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, c.chatCompletionsURL(), bytes.NewReader(payload))
	if err != nil {
		return nil, meta, err
	}
	httpReq.Header.Set("Authorization", "Bearer "+c.apiKey)
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("HTTP-Referer", "https://demo.99rtp.io")
	httpReq.Header.Set("X-Title", "Tap Trade market translation")

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, meta, err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return nil, meta, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, meta, fmt.Errorf("translation provider returned %d: %s", resp.StatusCode, string(respBody))
	}

	var parsed openAIChatResponse
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return nil, meta, err
	}
	if parsed.Usage.PromptTokens > 0 {
		meta.InputTokens = &parsed.Usage.PromptTokens
	}
	if parsed.Usage.CompletionTokens > 0 {
		meta.OutputTokens = &parsed.Usage.CompletionTokens
	}
	if len(parsed.Choices) == 0 {
		return nil, meta, errors.New("translation provider returned no choices")
	}
	content := parsed.Choices[0].Message.Content
	translations, err := parseTranslations(content)
	if err != nil {
		return nil, meta, err
	}
	return translations, meta, nil
}

func (c *OpenAICompatibleClient) chatCompletionsURL() string {
	if strings.HasSuffix(c.endpoint, "/chat/completions") {
		return c.endpoint
	}
	return c.endpoint + "/chat/completions"
}

type openAIChatRequest struct {
	Model          string            `json:"model"`
	Temperature    *float64          `json:"temperature,omitempty"`
	ResponseFormat map[string]string `json:"response_format,omitempty"`
	Messages       []openAIMessage   `json:"messages"`
}

type openAIMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type openAIChatResponse struct {
	Choices []struct {
		Message openAIMessage `json:"message"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
	} `json:"usage"`
}

func ptrFloat(v float64) *float64 {
	return &v
}

func systemPrompt(locales []LocaleSpec) string {
	localeNames := make([]string, 0, len(locales))
	for _, locale := range locales {
		localeNames = append(localeNames, locale.Code+" ("+locale.Name+")")
	}
	return "You translate prediction-market contract copy for Tap Trade. " +
		"English is the legally canonical settlement language; translations are display copy only. " +
		"Do not add, remove, soften, or reinterpret settlement conditions. " +
		"Preserve ticker-like symbols, URLs, dates, numbers, percentages, prices, team/player/company/person names unless there is a standard local-language rendering. " +
		"Preserve the tokens YES and NO exactly in uppercase. " +
		"Return only strict JSON shaped as {\"translations\":{\"locale\":{\"title\":\"...\",\"description\":\"...\"}}}. " +
		"Target locales: " + strings.Join(localeNames, ", ") + "."
}

func userPrompt(req TranslationRequest) string {
	payload := struct {
		Ticker      string   `json:"ticker"`
		Title       string   `json:"title"`
		Description string   `json:"description"`
		Locales     []string `json:"locales"`
	}{
		Ticker:      req.Market.Ticker,
		Title:       req.Market.Title,
		Description: req.Market.Description,
		Locales:     make([]string, 0, len(req.Locales)),
	}
	for _, locale := range req.Locales {
		payload.Locales = append(payload.Locales, locale.Code)
	}
	b, err := json.Marshal(payload)
	if err != nil {
		return "{}"
	}
	return string(b)
}

func parseTranslations(content string) (map[string]Translation, error) {
	content = strings.TrimSpace(content)
	content = strings.TrimPrefix(content, "```json")
	content = strings.TrimPrefix(content, "```")
	content = strings.TrimSuffix(content, "```")
	content = strings.TrimSpace(content)

	var wrapped struct {
		Translations map[string]Translation `json:"translations"`
	}
	if err := json.Unmarshal([]byte(content), &wrapped); err == nil && len(wrapped.Translations) > 0 {
		return wrapped.Translations, nil
	}

	var direct map[string]Translation
	if err := json.Unmarshal([]byte(content), &direct); err != nil {
		return nil, fmt.Errorf("parse translation JSON: %w", err)
	}
	if len(direct) == 0 {
		return nil, errors.New("translation JSON contained no locales")
	}
	return direct, nil
}
