import { storage } from "./storage";

type Operation = readonly (string | number)[];
const prefix = "pending-transfer:";
const remembered = new Map<string, string>();

export function pendingTransfers(wallet: string): Operation[] {
  const keys = new Set([...storage.getAllKeys(), ...remembered.keys()]);
  const result: Operation[] = [];
  for (const key of keys) {
    if (!key.startsWith(prefix)) continue;
    try {
      const parts: unknown = JSON.parse(key.slice(prefix.length));
      if (Array.isArray(parts) && parts[1] === wallet.toLowerCase() &&
          parts.every(part => typeof part === "string" || typeof part === "number")) result.push(parts);
    } catch { /* An unreadable receipt cannot be submitted. */ }
  }
  return result;
}

const active = new Map<string, Promise<unknown>>();

/** Keep the irreversible transfer separate from the retryable server receipt. */
export function confirmTransfer<T>(
  operation: Operation,
  send: (remember: (hash: string) => void, forgetReverted: () => void) => Promise<string>,
  confirm: (hash: string) => Promise<T>,
): Promise<T> {
  const key = prefix + JSON.stringify(operation);
  const current = active.get(key);
  if (current) return current as Promise<T>;
  const remember = (hash: string) => {
    remembered.set(key, hash);
    storage.set(key, hash);
  };
  const forget = () => {
    storage.delete(key);
    remembered.delete(key);
  };
  const run = Promise.resolve().then(async () => {
    let hash = remembered.get(key) ?? storage.getString(key);
    if (!hash) {
      hash = await send(remember, forget);
      remember(hash);
    }
    const result = await confirm(hash);
    forget();
    return result;
  }).finally(() => active.delete(key));
  active.set(key, run);
  return run;
}
