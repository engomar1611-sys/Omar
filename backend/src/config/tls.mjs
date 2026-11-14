import { readFileSync } from 'node:fs';

export function loadHttpsOptions(
  { tlsCertFile = null, tlsKeyFile = null } = {},
  readFile = readFileSync
) {
  const hasCertificate = Boolean(tlsCertFile);
  const hasPrivateKey = Boolean(tlsKeyFile);

  if (hasCertificate !== hasPrivateKey) {
    throw new Error('TLS_CERT_FILE and TLS_KEY_FILE must be configured together');
  }
  if (!hasCertificate) return undefined;

  return {
    cert: readFile(tlsCertFile),
    key: readFile(tlsKeyFile)
  };
}
