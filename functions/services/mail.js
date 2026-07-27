export function createMailTransport(nodemailer, { host, port, secure, user, pass } = {}) {
  if (!nodemailer || !host || !user || !pass) return null;

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass }
  });
}

export default createMailTransport;
