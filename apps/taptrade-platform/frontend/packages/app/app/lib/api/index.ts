// Base API client
export { apiClient, ApiError } from "./client";

// Auth client
export {
  login,
  refresh,
  register,
  forgotPassword,
  resetPassword,
  verifyEmail,
  verifyLoginMfa,
  getMfaStatus,
  startMfaEnrollment,
  activateMfa,
  disableMfa,
  isMfaChallenge,
  changePassword,
  acceptTerms,
  type GoLoginRequest,
  type GoLoginResponse,
  type GoRefreshResponse,
  type RegisterRequest,
  type RegisterResponse,
  type ForgotPasswordRequest,
  type ForgotPasswordResponse,
  type ResetPasswordRequest,
  type ResetPasswordResponse,
  type VerifyEmailRequest,
  type VerifyEmailResponse,
  type MfaChallenge,
  type MfaEnrollment,
  type MfaStatus,
  type ChangePasswordRequest,
  type ChangePasswordResponse,
  type AcceptTermsRequest,
  type AcceptTermsResponse,
} from "./auth-client";

// Wallet client
export {
  getBalance,
  getTransactions,
  type GetTransactionsParams,
  type Balance,
  type Transaction,
  type GetTransactionsPaginatedResponse,
} from "./wallet-client";

// User client
export {
  getProfile,
  updateProfile,
  updatePreferences,
  deleteAccount,
  type UpdateProfileRequest,
  type UpdatePreferencesRequest,
  type UserProfile,
  type Preferences,
  type DeleteAccountResponse,
} from "./user-client";

// Loyalty client (Predict-native; see PLAN-loyalty-leaderboards.md)
export {
  getLoyaltyStanding,
  getLoyaltyLedger,
  getLoyaltyTiers,
  resetLoyaltyCaches,
  type LoyaltyStanding,
  type LoyaltyLedgerEntry,
  type LoyaltyTier,
} from "./loyalty-client";

// Leaderboards client (Predict-native; see PLAN-loyalty-leaderboards.md)
export {
  getLeaderboards,
  getLeaderboardEntries,
  getUserStanding,
  type LeaderboardDefinition,
  type LeaderboardEntry,
  type PredictBoardWindow,
} from "./leaderboards-client";

// Compliance client
export {
  setPointUseLimits,
  setPredictionLimits,
  setSessionLimits,
  coolOff,
  selfExclude,
  getLimitsHistory,
  type SetPointUseLimitsRequest,
  type SetPredictionLimitsRequest,
  type SetSessionLimitsRequest,
  type CoolOffRequest,
  type SelfExcludeRequest,
  type PointUseLimits,
  type PredictionLimits,
  type SessionLimits,
  type CoolOffResponse,
  type SelfExcludeResponse,
  type GetLimitsHistoryResponse,
  type LimitHistoryItem,
} from "./compliance-client";
