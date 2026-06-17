import { useSaveCredentials, getGetCredentialsStatusQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { markAuthenticated } from "@/App";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Droplets, Loader2 } from "lucide-react";

const formSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

export default function Login() {
  const queryClient = useQueryClient();
  const saveMutation = useSaveCredentials();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { username: "", password: "" },
  });

  function onSubmit(values: z.infer<typeof formSchema>) {
    saveMutation.mutate({ data: values }, {
      onSuccess: () => {
        markAuthenticated();
        queryClient.invalidateQueries({ queryKey: getGetCredentialsStatusQueryKey() });
      },
      onError: () => {
        form.setError("password", { message: "Invalid username or password" });
      },
    });
  }

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm space-y-8">

        {/* Logo */}
        <div className="flex flex-col items-center gap-3">
          <div className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center shadow-lg">
            <Droplets className="w-9 h-9 text-primary-foreground" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">eWater Monitor</h1>
            <p className="text-sm text-muted-foreground mt-1">Sign in to your account</p>
          </div>
        </div>

        {/* Form */}
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="username"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Username</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Enter your username"
                      autoCapitalize="none"
                      autoComplete="username"
                      autoFocus
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      placeholder="Enter your password"
                      autoComplete="current-password"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button
              type="submit"
              className="w-full mt-2"
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Signing in…</>
                : "Sign In"
              }
            </Button>
          </form>
        </Form>
      </div>
    </div>
  );
}
