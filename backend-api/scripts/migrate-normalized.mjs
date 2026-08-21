import { createDataRepository } from "../src/dataRepository.js";

process.env.WORKSPACE_NORMALIZED_TABLES = "mirror";

function createDefaultDb() {
  return {
    users: [],
    projects: [],
    columns: [],
    tasks: [],
    subtasks: [],
    blocks: [],
    templates: [],
    reminders: [],
    calendarEvents: [],
    spaces: {},
    activity: [],
    securityEvents: [],
    notifications: [],
    joinRequests: [],
    sessions: [],
    authCodes: [],
    outbox: [],
  };
}

const repository = createDataRepository({ createDefaultDb });
const db = await repository.read();
await repository.write(db);

console.log("Normalized tables migration completed");
console.log(`Projects: ${(db.projects ?? []).length}`);
console.log(`Tasks: ${(db.tasks ?? []).length}`);
console.log(`Spaces: ${Object.keys(db.spaces ?? {}).length}`);
