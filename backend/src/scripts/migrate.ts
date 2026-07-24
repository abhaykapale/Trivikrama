async function main(): Promise<void> {
  throw new Error(
    "Database migrations are not implemented yet. Use the upcoming PostgreSQL migration runner.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
