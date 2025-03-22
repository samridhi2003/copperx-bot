import { Context } from 'telegraf';

export interface SessionData {
  authToken?: string;
  organizationId?: string;
  email?: string;
  awaitingEmail?: boolean;
  awaitingOTP?: boolean;
  sid?: string;
  transferType?: 'email' | 'wallet' | 'bank';
  transferStep?: 'recipient' | 'address' | 'amount' | 'bank_details' | 'customer_details' | 'customer_email' | 'customer_country' | 'source_salary' | 'source_savings' | 'source_lottery' | 'source_investment' | 'source_loan' | 'source_business_income' | 'source_others' | 'accept_quote' | 'cancel_quote' | 'select_bank';
  transferRecipient?: string;
  transferAddress?: string;
  network?: string;
  commandType?: 'send' | 'withdraw';
  transferAmount?: string;
  sourceOfFunds?: string;
  customerName?: string;
  customerEmail?: string;
  customerCountry?: string;
  depositStep?: 'amount';
  depositSourceOfFunds?: string;
  quotePayload?: string;
  quoteSignature?: string;
  arrivalTimeMessage?: string;
  selectedBankId?: string;
}

type CallbackData = 'send_email' | 'send_wallet' | 'withdraw_bank' | 'withdraw_wallet';

export interface BotContext extends Context {
  session: SessionData;
}

export interface CopperxAuthResponse {
  token: string;
  organizationId: string;
}

interface TokenBalance {
  decimals: number;
  balance: string;
  symbol: string;
  address: string;
}

export interface WalletBalance {
  walletId: string;
  isDefault: boolean;
  network: string;
  balances: TokenBalance[];
}

interface AccountDetails {
  id: string;
  createdAt: string;
  updatedAt: string;
  type: string;
  country: string;
  network: string;
  accountId: string;
  walletAddress: string;
  bankName?: string;
  bankAddress?: string;
  bankRoutingNumber?: string;
  bankAccountNumber?: string;
  bankDepositMessage?: string;
  wireMessage?: string;
  payeeEmail?: string;
  payeeOrganizationId?: string;
  payeeId?: string;
  payeeDisplayName?: string;
}

interface CustomerDetails {
  id: string;
  createdAt: string;
  updatedAt: string;
  name: string;
  businessName: string;
  email: string;
  country: string;
}

export interface Transfer {
  id: string;
  createdAt: string;
  updatedAt: string;
  organizationId: string;
  status: string;
  customerId: string;
  customer: CustomerDetails;
  type: string;
  sourceCountry: string;
  destinationCountry: string;
  destinationCurrency: string;
  amount: string;
  currency: string;
  amountSubtotal: string;
  totalFee: string;
  feePercentage: string;
  feeCurrency: string;
  invoiceNumber?: string;
  invoiceUrl?: string;
  sourceOfFundsFile?: string;
  note?: string;
  purposeCode: string;
  sourceOfFunds: string;
  recipientRelationship: string;
  sourceAccountId: string;
  destinationAccountId: string;
  paymentUrl?: string;
  mode: string;
  isThirdPartyPayment: boolean;
  sourceAccount: AccountDetails;
  destinationAccount: AccountDetails;
  senderDisplayName: string;
} 