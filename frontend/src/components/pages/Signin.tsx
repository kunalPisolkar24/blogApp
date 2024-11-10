import React, { useState, useEffect } from 'react';
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import signupImage from "../../assets/signupImage.jpg";
import { useToast } from "@/hooks/use-toast";
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { signinSchema, SigninSchemaType } from '@kunalpisolkar24/blogapp-common';
import LoadingSpinner from "./LoadingSpinner";


const SigninCard: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false); // Add loading state
  const { toast } = useToast();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true); // Set loading to true

    try {
      const parsedInput = signinSchema.safeParse({ email, password });

      if (!parsedInput.success) {
        toast({
          variant: 'destructive',
          title: 'Error',
          description: parsedInput.error.errors[0].message,
        });
        setLoading(false); // Set loading to false
        return;
      }

      const validatedInput: SigninSchemaType = parsedInput.data;

      const response = await axios.post('https://blogapp.kpisolkar24.workers.dev/api/signin', validatedInput);

      localStorage.setItem('jwt', response.data.jwt);
      toast({
        title: "Success",
        description: "Successfully signed in",
      });
      navigate('/');

    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: "Error",
        description: "Invalid credentials",
      });
      console.error("Sign-in failed:", error);
    } finally {
      setLoading(false); // Set loading to false
    }
  };

  if (loading) {
    return <LoadingSpinner />; // Render spinner if loading
  }

  return (
    <div className="flex items-center justify-center h-screen">
      <div className="bg-background p-8 rounded-lg shadow-lg w-full max-w-md">
        <div className="text-center space-y-4">
          <h1 className="text-3xl font-bold">Sign In</h1>
          <p className="text-muted-foreground">Login to your Account</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 mt-8">
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" placeholder="Enter your email" value={email} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" placeholder="Enter your password" value={password} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)} />
          </div>
          <Button type="submit" className="w-full">
            Sign In
          </Button>
        </form>
      </div>
    </div>
  )
}


const useIsLargeScreen = () => {
  const [isLarge, setIsLarge] = useState(window.innerWidth >= 1024);

  useEffect(() => {
    const handleResize = () => {
      setIsLarge(window.innerWidth >= 1024);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return isLarge;
};

const Signin: React.FC = () => {
  const isLargeScreen = useIsLargeScreen();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false); // Add loading state

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true); // Set loading to true

    try {
      const parsedInput = signinSchema.safeParse({ email, password });

      if (!parsedInput.success) {
        toast({
          variant: 'destructive',
          title: 'Error',
          description: parsedInput.error.errors[0].message,
        });
        setLoading(false); // Set loading to false
        return;
      }

      const validatedInput: SigninSchemaType = parsedInput.data;

      const response = await axios.post('https://blogapp.kpisolkar24.workers.dev/api/signin', validatedInput);
      localStorage.setItem('jwt', response.data.jwt);

      toast({
        title: "Success",
        description: "Successfully signed in",
      });
      navigate('/');

    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: "Error",
        description: "Invalid credentials",
      });
      console.error("Sign-in failed:", error);
    } finally {
      setLoading(false); // Set loading to false
    }
  };

  if (loading) {
    return <LoadingSpinner />; // Render spinner if loading
  }

  if (!isLargeScreen) {
    return <SigninCard />;
  }

  return (
    <main className="flex min-h-screen items-center justify-center py-6">
      <section className="container px-4 md:px-6">
        <div className="grid gap-6 lg:grid-cols-[1fr_400px] lg:gap-12 xl:grid-cols-[1fr_600px]">
          <div className="flex flex-col justify-center space-y-4">
            <div className="space-y-2">
              <h1 className="text-3xl font-bold tracking-tighter sm:text-5xl xl:text-6xl/none">
                Share your stories with the world
              </h1>
              <p className="max-w-[600px] text-muted-foreground md:text-xl">
                Join our blogging community and start publishing your content today.
              </p>
            </div>
            <div className="w-full max-w-sm space-y-2">
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" placeholder="Enter your email" required value={email} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input id="password" type="password" placeholder="Enter your Password" required value={password} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)} />
                </div>
                <Button type="submit" className="w-full">
                  Sign In
                </Button>
              </form>
            </div>
          </div>
          <img
            src={signupImage}
            width="550"
            height="550"
            alt="Hero"
            className="mx-auto aspect-video overflow-hidden rounded-xl object-cover sm:w-full lg:order-last lg:aspect-square"
          />
        </div>
      </section>
    </main>
  );
}

export default Signin;
