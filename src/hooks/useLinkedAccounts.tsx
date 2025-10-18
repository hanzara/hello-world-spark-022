import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { usePaystackIntegration } from '@/hooks/usePaystackIntegration';

export interface LinkedAccount {
  id: string;
  user_id: string;
  account_type: 'mobile_money' | 'card' | 'bank';
  provider: string;
  account_name?: string;
  account_number?: string;
  phone_number?: string;
  authorization_code?: string;
  is_primary: boolean;
  is_active: boolean;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
  last_used_at?: string;
}

export const useLinkedAccounts = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { initializePayment } = usePaystackIntegration();

  // Fetch all linked accounts
  const { data: linkedAccounts, isLoading } = useQuery({
    queryKey: ['linked-accounts', user?.id],
    queryFn: async () => {
      if (!user) return [];

      const { data, error } = await supabase
        .from('linked_accounts')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .order('is_primary', { ascending: false })
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as LinkedAccount[];
    },
    enabled: !!user,
  });

  // Link a new account via Paystack
  const linkAccountMutation = useMutation({
    mutationFn: async (params: {
      accountType: 'mobile_money' | 'card' | 'bank';
      provider: string;
      phoneNumber?: string;
      email: string;
      accountName?: string;
    }) => {
      if (!user) throw new Error('User not authenticated');

      // For card and bank, use Paystack tokenization
      if (params.accountType === 'card' || params.accountType === 'bank') {
        // Initialize Paystack for tokenization (small amount that will be refunded)
        const result = await initializePayment.mutateAsync({
          email: params.email,
          phoneNumber: params.phoneNumber || '',
          amount: 100, // Small amount for verification
          purpose: 'other',
          description: `Link ${params.accountType} account`,
          metadata: {
            link_account: true,
            account_type: params.accountType,
            provider: params.provider,
            account_name: params.accountName,
          },
        });

        if (!result.success) {
          throw new Error(result.error || 'Failed to initialize account linking');
        }

        // The actual account will be created via webhook after successful payment
        return result;
      }

      // For mobile money, create the linked account directly
      const { data, error } = await supabase
        .from('linked_accounts')
        .insert({
          user_id: user.id,
          account_type: params.accountType,
          provider: params.provider,
          phone_number: params.phoneNumber,
          account_name: params.accountName,
          is_primary: false,
          is_active: true,
          metadata: {
            linked_via: 'direct',
            linked_at: new Date().toISOString(),
          },
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['linked-accounts'] });
      
      if (variables.accountType === 'mobile_money') {
        toast({
          title: '✅ Account Linked Successfully',
          description: `Your ${variables.provider} account has been connected to your Verdio wallet.`,
        });
      } else {
        toast({
          title: '🔐 Verification Started',
          description: 'Complete the payment to verify and link your account.',
        });
      }
    },
    onError: (error: any) => {
      toast({
        title: '❌ Failed to Link Account',
        description: error.message || 'Please try again',
        variant: 'destructive',
      });
    },
  });

  // Set primary account
  const setPrimaryAccountMutation = useMutation({
    mutationFn: async (accountId: string) => {
      if (!user) throw new Error('User not authenticated');

      // First, unset all primary accounts
      await supabase
        .from('linked_accounts')
        .update({ is_primary: false })
        .eq('user_id', user.id);

      // Set the new primary account
      const { data, error } = await supabase
        .from('linked_accounts')
        .update({ is_primary: true })
        .eq('id', accountId)
        .eq('user_id', user.id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['linked-accounts'] });
      toast({
        title: '✅ Primary Account Updated',
        description: 'Your default payment method has been changed.',
      });
    },
    onError: (error: any) => {
      toast({
        title: '❌ Failed to Update',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Deactivate/Remove account
  const removeAccountMutation = useMutation({
    mutationFn: async (accountId: string) => {
      if (!user) throw new Error('User not authenticated');

      const { error } = await supabase
        .from('linked_accounts')
        .update({ is_active: false })
        .eq('id', accountId)
        .eq('user_id', user.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['linked-accounts'] });
      toast({
        title: '🗑️ Account Removed',
        description: 'The linked account has been disconnected.',
      });
    },
    onError: (error: any) => {
      toast({
        title: '❌ Failed to Remove',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Sync mobile money balance
  const syncBalanceMutation = useMutation({
    mutationFn: async (params: { accountId: string; phoneNumber: string }) => {
      if (!user) throw new Error('User not authenticated');

      // Get account provider info
      const account = linkedAccounts?.find(acc => acc.id === params.accountId);

      const { data, error } = await supabase.functions.invoke('sync-mpesa-balance', {
        body: {
          accountId: params.accountId,
          phoneNumber: params.phoneNumber,
          provider: account?.provider || 'mpesa',
        },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['linked-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['central-wallet'] });
      
      toast({
        title: '✅ Balance Synced',
        description: `Your mobile money balance has been updated: KES ${data.balance?.toFixed(2)}`,
      });
    },
    onError: (error: any) => {
      toast({
        title: '❌ Sync Failed',
        description: error.message || 'Failed to sync mobile money balance',
        variant: 'destructive',
      });
    },
  });

  return {
    linkedAccounts,
    isLoading,
    linkAccount: linkAccountMutation.mutateAsync,
    isLinkingAccount: linkAccountMutation.isPending,
    setPrimaryAccount: setPrimaryAccountMutation.mutateAsync,
    removeAccount: removeAccountMutation.mutateAsync,
    syncBalance: syncBalanceMutation.mutateAsync,
    isSyncingBalance: syncBalanceMutation.isPending,
  };
};
