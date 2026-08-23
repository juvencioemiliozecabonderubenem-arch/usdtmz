
import { neon } from "@neondatabase/serverless";
import { TronWeb } from "tronweb";

function parseUsdtAmount(value) {
  const text = String(value ?? "").trim();

  if (!/^\d+(\.\d{1,6})?$/.test(text)) {
    return null;
  }

  const [whole, decimal = ""] = text.split(".");
  const padded = decimal.padEnd(6, "0");

  return BigInt(whole) * 1_000_000n + BigInt(padded);
}

function formatUsdtAmount(raw) {
  const value = BigInt(raw);

  const whole = value / 1_000_000n;

  const decimal =
    (value % 1_000_000n)
      .toString()
      .padStart(6, "0");

  return `${whole}.${decimal}`;
}
