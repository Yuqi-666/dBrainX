// SPDX-License-Identifier: AGPL-3.0-only

// Shipped only in Desktop resources; the Web server uses its existing PocketBase setup.
routerUse((event) => {
  const secret = $os.getenv("DBRAINX_PB_SECRET");
  if (!secret || event.request.header.get("X-DBrainX-Internal") !== secret) {
    throw new ForbiddenError("Local database access requires the backend");
  }
  return event.next();
});
