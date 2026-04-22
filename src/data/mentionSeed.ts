import type { AuthUser } from "../types";

const mentionSeed = [
  { name: "Abby Gugino", email: "abbyg@dieselpowerproducts.com" },
  { name: "Abigail McKee", email: "abigail@dieselpowerproducts.com" },
  { name: "Cade Carlson", email: "cade@dieselpowerproducts.com" },
  { name: "Constance Murphy", email: "constance@dieselpowerproducts.com" },
  { name: "Corbin Carlton", email: "corbin@dieselpowerproducts.com" },
  { name: "Evie Wehrlie", email: "evelyn@dieselpowerproducts.com" },
  { name: "Jackie Jacobs", email: "jackie@dieselpowerproducts.com" },
  { name: "Jared John", email: "jared@dieselpowerproducts.com" },
  { name: "Jen Kemp", email: "jen@dieselpowerproducts.com" },
  { name: "Jesse Young", email: "jesse@dieselpowerproducts.com" },
  { name: "Josh Ullrich", email: "josh@dieselpowerproducts.com" },
  { name: "Kameron Lund", email: "kameron@dieselpowerproducts.com" },
  { name: "Kobe Rea", email: "kobe@dieselpowerproducts.com" },
  { name: "Kolby Trejbal", email: "kolby@dieselpowerproducts.com" },
  { name: "Kyle Bickley", email: "kyle@dieselpowerproducts.com" },
  { name: "Lanee Carman", email: "delanee@dieselpowerproducts.com" },
  { name: "Natasha Wright", email: "natasha@dieselpowerproducts.com" },
  { name: "Tim Barfknecht", email: "tim@dieselpowerproducts.com" },
  { name: "Will Standish", email: "will@dieselpowerproducts.com" }
] as const;

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function getMentionSeedUsers(): AuthUser[] {
  return mentionSeed.map((user) => ({
    sub: `seed:${normalizeEmail(user.email)}`,
    email: normalizeEmail(user.email),
    name: user.name,
    picture: "",
    hd: "dieselpowerproducts.com"
  }));
}
