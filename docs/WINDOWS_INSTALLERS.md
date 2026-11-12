# Windows Installers — NEW FEED ERP

The Windows Installers workflow creates two artifacts:
- Employee Setup EXE: Electron desktop client with Arabic server definition screen, saved server URL, and /ready connection test.
- Server Setup EXE: installs the Node.js API payload and registers a Windows service named NewFeedERP.

## Server prerequisites
- Windows Server x64.
- PostgreSQL 16 must already be installed and reachable. The application installer does not bundle the PostgreSQL database engine.
- A PostgreSQL service account with permission to create and migrate the schema.
- A trusted TLS certificate and reverse proxy are required before employee PCs connect over HTTPS. The current server installer does not configure production TLS.

## Install server
1. Install PostgreSQL 16 and create the database/service user.
2. Run the server setup EXE as Administrator.
3. Enter DATABASE_URL and the API port; create the first administrator if the database is empty.
4. The setup checks PostgreSQL, runs migrations, registers and starts the Windows service.
5. Verify the service in services.msc and inspect its service logs.

## Install employee client
1. Install the employee EXE on each Windows PC.
2. Open the app and select the System Definition menu.
3. Enter the server HTTPS URL and port, test, then save.
4. The server certificate must be trusted by Windows. The client never bypasses TLS errors.

## Build and download
Open GitHub Actions and select Windows Installers. After build-windows succeeds, download the Employee and Server EXE artifacts. Artifacts are unsigned and retained for 14 days. Authenticode signing is required before production distribution. A successful CI build is not a substitute for testing installation on the factory server and employee PCs.
