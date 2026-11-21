/** Demo data must never reach production Firestore. */
export function assertEmulatorOnly(projectId: string): void {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Refusing to seed: FIRESTORE_EMULATOR_HOST is not set (seed runs only against the Firestore emulator).');
  if (!projectId.startsWith('demo-')) throw new Error(`Refusing to seed: project "${projectId}" is not a demo- project (use --project demo-tropaclub).`);
}
