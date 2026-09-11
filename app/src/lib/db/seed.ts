// Seeds the minimal internal users referenced in architecture.md's Phase 0
// task list. Run with `npm run seed` after `npm run db:push`.
import "dotenv/config";
import { db } from "./index";
import { users } from "./schema";

async function main() {
  const seedUsers = [
    { name: "Mide Giwa", email: "olamidegiwa21@gmail.com", role: "salesperson" as const },
    { name: "Approving Manager", email: "approver@example.com", role: "approver" as const },
  ];

  for (const u of seedUsers) {
    await db.insert(users).values(u).onConflictDoNothing({ target: users.email });
  }

  console.log(`Seeded ${seedUsers.length} users.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
