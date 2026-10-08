export function handleMaintenanceRequest(req, res) {
  const pathname = (req.url ?? "").split("?")[0];

  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (
    pathname === "/health" &&
    (req.method === "GET" || req.method === "HEAD")
  ) {
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
    });

    res.end(JSON.stringify({
      ok: true,
      service: "staging-maintenance",
    }));
    return;
  }

  res.writeHead(503, {
    "Content-Type": "application/json; charset=utf-8",
    "Retry-After": "120",
  });

  res.end(JSON.stringify({
    success: false,
    code: "STAGING_MAINTENANCE",
    message: "Ambiente de homologação em manutenção.",
  }));
}
