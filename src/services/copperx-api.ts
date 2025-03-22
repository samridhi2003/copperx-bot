import axios, { AxiosInstance } from 'axios';
import { CopperxAuthResponse, Transfer } from '../types';
import crypto from 'crypto';

interface UserProfile {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  profileImage: string;
  organizationId: string;
  role: 'owner' | string;
  status: 'pending' | string;
  type: 'individual' | string;
  relayerAddress: string;
  flags: string[];
  walletAddress: string;
  walletId: string;
  walletAccountType: string;
}

interface WalletResponse {
  id: string;
  createdAt: string;
  updatedAt: string;
  organizationId: string;
  walletType: string;
  isDefault: boolean | null;
  network: string;
  walletAddress: string;
  balance?: string;
}

interface TokenBalance {
  symbol: string;
  balance: string;
  decimals: number;
  address: string;
}

interface WalletBalance {
  walletId: string;
  isDefault: boolean | null;
  network: string;
  balances: TokenBalance[];
}

export class CopperxAPI {
  private client: AxiosInstance;
  private readonly networkMapping: { [key: string]: string } = {
    '137': 'Polygon',
    '42161': 'Arbitrum',
    '8453': 'Base',
    '1': 'Ethereum',
    '56': 'BSC',
    'solana': 'Solana'
  };

  constructor(baseURL: string) {
    this.client = axios.create({
      baseURL,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  private setAuthToken(token: string) {
    this.client.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  }

  private getNetworkName(networkId: string): string {
    return this.networkMapping[networkId] || networkId;
  }

  // Authentication
  async requestEmailOTP(email: string): Promise<{ sid: string }> {
    const response = await this.client.post('/api/auth/email-otp/request', { email });
    return { sid: response.data.sid };
  }

  async authenticateWithOTP(email: string, otp: string, sid: string): Promise<CopperxAuthResponse> {
    const response = await this.client.post('/api/auth/email-otp/authenticate', { email, otp, sid });
    console.log('Authentication response:', JSON.stringify(response.data, null, 2));
    console.log('Response data keys:', Object.keys(response.data));
    
    // Extract organization ID from the user object in the response
    const token = response.data.accessToken;
    const organizationId = response.data.user?.organizationId;
    
    console.log('Extracted values:', {
      hasToken: !!token,
      tokenPrefix: token ? token.substring(0, 5) + '...' : 'missing',
      hasOrgId: !!organizationId,
      organizationId: organizationId || 'missing'
    });
    
    this.setAuthToken(token);
    return { token, organizationId };
  }

  async getUserProfile(token: string): Promise<UserProfile> {
    this.setAuthToken(token);
    const response = await this.client.get('/api/auth/me');
    return response.data;
  }

  async getKYCStatus(token: string) {
    this.setAuthToken(token);
    const response = await this.client.get('/api/kycs');
    console.log('KYC status response:', response.data);
    return response.data.data[0].status;
  }

  // Wallet Management
  async getWallets(token: string): Promise<WalletResponse[]> {
    this.setAuthToken(token);
    
    try {
      const response = await this.client.get('/api/wallets');
   
      const wallets = Array.isArray(response.data) ? response.data : (response.data.data || []);
      const balances = await this.getWalletBalances(token);
      
      return wallets.map((wallet: WalletResponse) => {
        // Find corresponding balance info for this wallet
        const walletBalance = balances.find(b => b.walletId === wallet.id);
        const usdcBalance = walletBalance?.balances.find(b => b.symbol === 'USDC')?.balance || '0';
        
        return {
          id: wallet.id,
          createdAt: wallet.createdAt,
          updatedAt: wallet.updatedAt,
          organizationId: wallet.organizationId,
          walletType: wallet.walletType,
          isDefault: wallet.isDefault,
          network: this.getNetworkName(wallet.network),
          walletAddress: wallet.walletAddress,
          balance : usdcBalance
        };
      });
    } catch (error: any) {
      console.error('Failed to fetch wallets:', error.message);
      throw error;
    }
  }

  async getWalletBalances(token: string): Promise<WalletBalance[]> {
    this.setAuthToken(token);
    try {
      const response = await this.client.get('/api/wallets/balances');  
      // The response is already an array of wallet balances
      return response.data.map((balance: WalletBalance) => ({
        walletId: balance.walletId,
        isDefault: balance.isDefault,
        network: this.getNetworkName(balance.network),
        balances: balance.balances || []
      }));
    } catch (error: any) {
      console.error('Failed to fetch wallet balances:', error.message);
      throw error;
    }
  }

  async getDefaultWallet(token: string): Promise<WalletBalance> {
    this.setAuthToken(token);
    try {
      const response = await this.client.get('/api/wallets/default');
      console.log('Default wallet response:', JSON.stringify(response.data, null, 2));
      
      const wallet = response.data;
      return {
        walletId: wallet.walletId,
        isDefault: true,
        network: this.getNetworkName(wallet.network),
        balances: wallet.balances || []
      };
    } catch (error: any) {
      console.error('Failed to fetch default wallet:', error.message);
      throw error;
    }
  }

  async setDefaultWallet(token: string, walletId: string): Promise<void> {
    this.setAuthToken(token);
    try {
      await this.client.post('/api/wallets/default', { walletId });
      console.log('Successfully set default wallet:', walletId);
    } catch (error: any) {
      console.error('Failed to set default wallet:', error.message);
      throw error;
    }
  }

  // Transfers
  async sendToEmail(token: string, email: string, amount: string): Promise<Transfer> {
    this.setAuthToken(token);
    try {
      const response = await this.client.post('/api/transfers/send', { 
        email: email, 
        amount,
        purposeCode: 'self',
        currency: 'USDC'
      });
      console.log('Send to email response:', JSON.stringify(response.data, null, 2));
      return response.data;
    } catch (error: any) {
      console.error('Failed to send to email:', error.message);
      throw error;
    }
  }

  async sendToWallet(token: string, address: string, amount: string): Promise<Transfer> {
    this.setAuthToken(token);
    try {
      console.log('Initiating wallet withdrawal with params:', {
        walletAddress: address,
        amount,
        purposeCode: 'self',
        currency: 'USD'
      });

      const response = await this.client.post('/api/transfers/wallet-withdraw', {
        walletAddress: address,
        amount,
        purposeCode: 'self',
        currency: 'USDC',
      });

      console.log('Wallet withdrawal response:', {
        id: response.data.id,
        status: response.data.status,
        amount: response.data.amount,
        destinationAddress: response.data.destinationAccount?.walletAddress
      });

      return response.data;
    } catch (error: any) {
      console.error('Failed to process wallet withdrawal:', {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        details: error.response?.data?.message
      });
      throw error;
    }
  }

  // Keep withdrawToWallet for backward compatibility
  async withdrawToWallet(token: string, address: string, amount: string, network: string = 'Polygon'): Promise<Transfer> {
    this.setAuthToken(token);
    try {
      console.log('Initiating wallet withdrawal with params:', {
        walletAddress: address,
        amount,
        purposeCode: 'self',
        currency: 'USDC',
        network
      });

      const response = await this.client.post('/api/transfers/wallet-withdraw', {
        walletAddress: address,
        amount,
        purposeCode: 'self',
        currency: 'USDC',
        network
      });

      console.log('Wallet withdrawal response:', {
        id: response.data.id,
        status: response.data.status,
        amount: response.data.amount,
        destinationAddress: response.data.destinationAccount?.walletAddress
      });

      return response.data;
    } catch (error: any) {
      console.error('Failed to process wallet withdrawal:', {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        details: error.response?.data?.message
      });
      throw error;
    }
  }

  async withdrawToBank(token: string, amount: string, bankDetails: {
    quotePayload: string;
    quoteSignature: string;
    purposeCode: string;
  }): Promise<Transfer> {
    this.setAuthToken(token);
    try {
      const requestBody = {
        quotePayload: JSON.parse(bankDetails.quotePayload),
        quoteSignature: bankDetails.quoteSignature,
        purposeCode: bankDetails.purposeCode
      };

      console.log('Making withdrawToBank API request:', {
        url: '/api/transfers/offramp',
        body: requestBody
      });

      const response = await this.client.post('/api/transfers/offramp', requestBody);

      console.log('WithdrawToBank API response:', {
        status: response.status,
        data: response.data
      });

      return response.data;
    } catch (error: any) {
      console.error('WithdrawToBank API error:', {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        details: error.response?.data?.message || error.response?.data?.details
      });
      throw error;
    }
  }

  // Deposits
  async deposit(token: string, amount: string, sourceOfFunds: string, depositChainId: number): Promise<string> {
    this.setAuthToken(token);
    try {
      // Ensure amount is a string and properly formatted
      const formattedAmount = amount.toString();

      const requestBody = {
        amount: formattedAmount,
        sourceOfFunds,
        depositChainId
      };

      const response = await this.client.post('/api/transfers/deposit', requestBody);

      // Return the deposit URL from the first transaction in the transactions array
      return response.data.transactions[0].depositUrl;
    } catch (error: any) {
      console.error('Deposit API error:', {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        headers: error.response?.headers,
        data: error.response?.data ? JSON.stringify(error.response.data, null, 2) : undefined,
        details: error.response?.data?.message || error.response?.data?.details,
        stack: error.stack
      });
      throw error;
    }
  }

  // Transactions
  async getTransactionHistory(token: string, page = 1, limit = 10): Promise<Transfer[]> {
    this.setAuthToken(token);
    try {
      const response = await this.client.get(`/api/transfers`, {
        params: { page, limit }
      });
      console.log('Transaction history response:', JSON.stringify(response.data, null, 2));
      
      const transfers = Array.isArray(response.data) ? response.data : (response.data.data || []);
      return transfers.map((transfer: Transfer) => ({
        ...transfer,
        // Map any additional fields needed for display
      }));
    } catch (error: any) {
      console.error('Failed to fetch transaction history:', error.message);
      throw error;
    }
  }

  async getTransferHistory(token: string, page = 1, limit = 10): Promise<Transfer[]> {
    this.setAuthToken(token);
    const response = await this.client.get(`/api/transfers?page=${page}&limit=${limit}`);
    return response.data;
  }

  // Notifications
  async authenticatePusher(token: string, socketId: string, channelName: string) {
    this.setAuthToken(token);
    const response = await this.client.post('/api/notifications/auth', {
      socket_id: socketId,
      channel_name: channelName,
    });
    return response.data;
  }

  // Bulk Transfers
  async sendBatchTransfers(token: string, transfers: Array<{
    email?: string;
    walletAddress?: string;
    amount: string;
    network?: string;
    requestId?: string;
  }>): Promise<{
    responses: Array<{
      requestId: string;
      request: {
        walletAddress?: string;
        email?: string;
        payeeId?: string;
        amount: string;
        purposeCode: string;
        currency: string;
      };
      response?: {
        id: string;
        status: string;
        amount: string;
        [key: string]: any;
      };
      error?: {
        message: any;
        statusCode: number;
        error: string;
      };
    }>;
  }> {
    this.setAuthToken(token);
    try {
      console.log('Initiating batch transfers:', JSON.stringify(transfers, null, 2));
      
      const requests = transfers.map(transfer => ({
        requestId: transfer.requestId || crypto.randomUUID(),
        request: {
          walletAddress: transfer.walletAddress,
          email: transfer.email,
          amount: transfer.amount,
          purposeCode: 'self',
          currency: 'USDC'
        }
      }));

      const response = await this.client.post('/api/transfers/send-batch', {
        requests
      });

      console.log('Batch transfers response:', JSON.stringify(response.data, null, 2));
      return response.data;
    } catch (error: any) {
      console.error('Failed to process batch transfers:', {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        details: error.response?.data?.message || error.response?.data?.details
      });
      throw error;
    }
  }

  async getOfframpQuote(token: string, amount: string, destinationCountry: string, preferredBankAccountId?: string): Promise<any> {
    this.setAuthToken(token);
    try {
      const requestBody = {
        amount,
        currency: "USDC",
        sourceCountry: "none",
        destinationCountry,
        onlyRemittance: true,
        preferredBankAccountId
      };

      console.log('Getting offramp quote with params:', requestBody);

      const response = await this.client.post('/api/quotes/offramp', requestBody);

      console.log('Offramp quote response:', response.data);

      return response.data;
    } catch (error: any) {
      console.error('Failed to get offramp quote:', {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        details: error.response?.data?.message
      });
      throw error;
    }
  }

  async getAccounts(token: string): Promise<any> {
    this.setAuthToken(token);
    try {
      const response = await this.client.get('/api/accounts');
      return response.data;
    } catch (error: any) {
      console.error('Failed to get accounts:', {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        details: error.response?.data?.message
      });
      throw error;
    }
  }
} 