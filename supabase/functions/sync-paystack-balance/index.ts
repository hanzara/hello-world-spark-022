import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization') || req.headers.get('authorization') || '';

    console.log('Sync balance request received');
    console.log('Auth header present:', !!authHeader);

    // Parse request body
    let body: any = null;
    try {
      body = await req.json();
    } catch (_) {
      // no body provided
    }

    console.log('Body user_id:', body?.user_id);

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: authHeader },
        },
      }
    );

    // Try to get user from auth
    const {
      data: { user },
      error: userError,
    } = await supabaseClient.auth.getUser();

    console.log('Auth user:', user?.id);
    console.log('Auth error:', userError);

    // Helper to extract user ID from JWT
    const getUserIdFromJWT = (header: string): string | null => {
      try {
        const token = header?.startsWith('Bearer ') ? header.split(' ')[1] : header;
        if (!token) return null;
        const payload = JSON.parse(atob(token.split('.')[1]));
        return payload.sub || payload.user_id || null;
      } catch (e) {
        console.error('JWT decode error:', e);
        return null;
      }
    };

    const userId = user?.id ?? getUserIdFromJWT(authHeader) ?? body?.user_id;

    console.log('Final userId:', userId);

    if (!userId) {
      throw new Error('Unauthorized: No user ID found');
    }

    // Get Paystack secret key
    const paystackSecretKey = Deno.env.get('PAYSTACK_SECRET_KEY');
    if (!paystackSecretKey) {
      throw new Error('Paystack secret key not configured');
    }

    // Fetch balance from Paystack API
    const balanceResponse = await fetch('https://api.paystack.co/balance', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${paystackSecretKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!balanceResponse.ok) {
      const errorData = await balanceResponse.json();
      throw new Error(`Paystack API error: ${errorData.message || 'Unknown error'}`);
    }

    const balanceData = await balanceResponse.json();

    if (!balanceData.status) {
      throw new Error('Failed to fetch Paystack balance');
    }

    // Paystack returns balance in kobo (1 NGN = 100 kobo) or cents
    // Convert to main currency unit (divide by 100)
    const paystackBalance = (balanceData.data[0]?.balance || 0) / 100;

    // Update user's central wallet with Paystack balance
    const { error: updateError } = await supabaseClient
      .from('user_central_wallets')
      .upsert({
        user_id: userId,
        balance: paystackBalance,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id'
      });

    if (updateError) {
      console.error('Error updating wallet:', updateError);
      throw new Error('Failed to update wallet balance');
    }

    // Log the sync for audit trail
    await supabaseClient.from('audit_logs').insert({
      user_id: userId,
      action: 'paystack_balance_sync',
      resource_type: 'wallet',
      resource_id: userId,
      new_values: { balance: paystackBalance },
    });

    return new Response(
      JSON.stringify({
        success: true,
        balance: paystackBalance,
        currency: balanceData.data[0]?.currency || 'NGN',
        synced_at: new Date().toISOString(),
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Paystack balance sync error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    );
  }
});
