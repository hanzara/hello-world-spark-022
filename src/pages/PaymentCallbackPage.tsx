import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const PaymentCallbackPage = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [status, setStatus] = useState<'verifying' | 'success' | 'failed'>('verifying');
  const [message, setMessage] = useState('Verifying your payment...');
  const [amount, setAmount] = useState<number>(0);

  useEffect(() => {
    const verifyPayment = async () => {
      const reference = searchParams.get('reference');
      
      if (!reference) {
        setStatus('failed');
        setMessage('Invalid payment reference');
        return;
      }

      try {
        // Check transaction status in database
        const { data: transaction, error } = await supabase
          .from('mpesa_transactions')
          .select('*, user_wallets(balance)')
          .eq('checkout_request_id', reference)
          .single();

        if (error) {
          console.error('Error fetching transaction:', error);
          setStatus('failed');
          setMessage('Payment verification failed. Please contact support if amount was deducted.');
          return;
        }

        if (transaction.status === 'success') {
          setStatus('success');
          setAmount(transaction.amount);
          setMessage('Payment successful! Your wallet has been updated.');
          
          toast({
            title: "✅ Payment Successful",
            description: `KES ${transaction.amount.toFixed(2)} has been added to your wallet`,
          });
        } else if (transaction.status === 'failed') {
          setStatus('failed');
          setMessage('Payment failed. Please try again.');
        } else {
          // Still pending, wait a bit more
          setTimeout(() => verifyPayment(), 2000);
        }
      } catch (err) {
        console.error('Verification error:', err);
        setStatus('failed');
        setMessage('An error occurred during verification');
      }
    };

    verifyPayment();
  }, [searchParams, toast]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            {status === 'verifying' && (
              <Loader2 className="h-16 w-16 text-primary animate-spin" />
            )}
            {status === 'success' && (
              <CheckCircle2 className="h-16 w-16 text-green-500" />
            )}
            {status === 'failed' && (
              <XCircle className="h-16 w-16 text-destructive" />
            )}
          </div>
          <CardTitle>
            {status === 'verifying' && 'Verifying Payment'}
            {status === 'success' && 'Payment Successful'}
            {status === 'failed' && 'Payment Failed'}
          </CardTitle>
          <CardDescription>{message}</CardDescription>
          {status === 'success' && amount > 0 && (
            <p className="text-2xl font-bold text-primary mt-4">
              KES {amount.toFixed(2)}
            </p>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {status !== 'verifying' && (
            <>
              <Button onClick={() => navigate('/dashboard')} className="w-full">
                Go to Dashboard
              </Button>
              <Button variant="outline" onClick={() => navigate('/')} className="w-full">
                Go to Home
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default PaymentCallbackPage;
