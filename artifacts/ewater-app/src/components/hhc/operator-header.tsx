import { useState } from "react";
import { useHhcOperatorLogin } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { UserCircle2 } from "lucide-react";
import {
  useOperatorSession, saveSession, clearSession, type OperatorSessionInfo,
} from "./operator";

/**
 * Compact operator sign-in control that lives in the blue app header bar.
 * Signed out: a "Sign in" button opening a popover with name + access key.
 * Signed in: the operator's name with a sign-out popover.
 */
export function OperatorHeader() {
  const session = useOperatorSession();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const login = useHhcOperatorLogin({
    mutation: {
      onSuccess: (data) => {
        saveSession(data as OperatorSessionInfo);
        setKey("");
        setError(null);
        setOpen(false);
      },
      onError: (err) => setError(err instanceof Error ? err.message : "Sign-in failed"),
    },
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          data-testid="button-header-operator"
          className="flex items-center gap-1.5 px-2.5 py-1.5 mr-1 rounded-full hover:bg-primary-foreground/10 transition-colors text-xs font-medium max-w-[40vw]"
          title={session ? `Signed in as ${session.operator}` : "Operator sign-in"}
        >
          <UserCircle2 className="w-4 h-4 shrink-0" />
          <span className="truncate">{session ? session.operator : "Sign in"}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        {session ? (
          <div className="space-y-2">
            <p className="text-xs" data-testid="text-operator-signed-in">
              Signed in as <span className="font-semibold">{session.operator}</span>
              <span className="ml-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">{session.role}</span>
            </p>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px] w-full"
              data-testid="button-operator-signout"
              onClick={() => { clearSession(); setOpen(false); }}
            >
              Sign out
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs font-semibold">Operator sign-in</p>
            <Input
              data-testid="input-operator-name"
              className="h-8 text-xs"
              placeholder="Your name / ID"
              value={name}
              onChange={(e) => { setName(e.target.value); setError(null); }}
            />
            <Input
              data-testid="input-operator-key"
              className="h-8 text-xs"
              type="password"
              placeholder="Access key"
              value={key}
              onChange={(e) => { setKey(e.target.value); setError(null); }}
            />
            <Button
              size="sm"
              className="h-8 text-xs w-full"
              disabled={login.isPending || !name.trim() || !key}
              data-testid="button-operator-login"
              onClick={() => login.mutate({ data: { operatorName: name.trim(), accessKey: key } })}
            >
              {login.isPending ? "Signing in…" : "Sign in"}
            </Button>
            {error && <p className="text-[10px] text-destructive">{error}</p>}
            <p className="text-[10px] text-muted-foreground">
              Commissioning actions require a verified operator token
            </p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
