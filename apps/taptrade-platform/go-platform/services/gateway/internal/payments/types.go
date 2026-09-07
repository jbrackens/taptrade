package payments

// Payment types for the sportsbook-era payment system

// PaymentMethod represents an available payment method
type PaymentMethod struct {
	ID           string   `json:"id"`
	Type         string   `json:"type"` // credit_card, debit_card, wallet, bank_transfer, crypto
	Label        string   `json:"label"`
	LastFour     string   `json:"lastFour,omitempty"`
	ExpiryDate   string   `json:"expiryDate,omitempty"`
	IsActive     bool     `json:"isActive"`
	IsDefault    bool     `json:"isDefault"`
	CreatedAt    string   `json:"createdAt"`
	Restrictions []string `json:"restrictions,omitempty"` // geolocation, amount_limits, etc
}

// DepositResult is returned after a deposit is initiated
type DepositResult struct {
	TransactionID    string            `json:"transactionId"`
	UserID           string            `json:"userId"`
	Amount           int64             `json:"amountCents"`
	Status           string            `json:"status"` // pending, approved, declined, failed
	PaymentMethod    string            `json:"paymentMethod"`
	CreatedAt        string            `json:"createdAt"`
	ProcessedAt      string            `json:"processedAt,omitempty"`
	ConfirmationCode string            `json:"confirmationCode,omitempty"`
	ErrorMessage     string            `json:"errorMessage,omitempty"`
	Metadata         map[string]string `json:"metadata,omitempty"`
}

// WithdrawalResult is returned after a withdrawal is initiated
type WithdrawalResult struct {
	TransactionID string            `json:"transactionId"`
	UserID        string            `json:"userId"`
	Amount        int64             `json:"amountCents"`
	Status        string            `json:"status"` // pending, approved, declined, failed, processed
	PaymentMethod string            `json:"paymentMethod"`
	CreatedAt     string            `json:"createdAt"`
	ProcessedAt   string            `json:"processedAt,omitempty"`
	EstimatedAt   string            `json:"estimatedAt,omitempty"`
	ErrorMessage  string            `json:"errorMessage,omitempty"`
	Metadata      map[string]string `json:"metadata,omitempty"`
}

// TransactionStatus represents the current status of a payment transaction
type TransactionStatus struct {
	TransactionID    string `json:"transactionId"`
	UserID           string `json:"userId"`
	Type             string `json:"type"` // deposit, withdrawal
	Amount           int64  `json:"amountCents"`
	Status           string `json:"status"`
	PaymentMethod    string `json:"paymentMethod"`
	CreatedAt        string `json:"createdAt"`
	UpdatedAt        string `json:"updatedAt"`
	ProcessedAt      string `json:"processedAt,omitempty"`
	ConfirmationCode string `json:"confirmationCode,omitempty"`
	ErrorMessage     string `json:"errorMessage,omitempty"`
}

// WebhookPayload represents a payment gateway webhook
type WebhookPayload struct {
	EventType     string            `json:"eventType"`
	TransactionID string            `json:"transactionId"`
	UserID        string            `json:"userId"`
	Amount        int64             `json:"amountCents"`
	Status        string            `json:"status"`
	Timestamp     string            `json:"timestamp"`
	Signature     string            `json:"signature"`
	Data          map[string]string `json:"data,omitempty"`
}

// InitiateDepositRequest is used to start a deposit
type InitiateDepositRequest struct {
	UserID        string            `json:"userId"`
	Amount        int64             `json:"amountCents"`
	PaymentMethod string            `json:"paymentMethod"`
	Currency      string            `json:"currency,omitempty"` // defaults to USD
	Metadata      map[string]string `json:"metadata,omitempty"`
}

// InitiateWithdrawalRequest is used to start a withdrawal
type InitiateWithdrawalRequest struct {
	UserID        string            `json:"userId"`
	Amount        int64             `json:"amountCents"`
	PaymentMethod string            `json:"paymentMethod"`
	Currency      string            `json:"currency,omitempty"` // defaults to USD
	Metadata      map[string]string `json:"metadata,omitempty"`
}
