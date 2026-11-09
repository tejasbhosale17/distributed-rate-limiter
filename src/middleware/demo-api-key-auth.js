function unauthorizedError() {
  return Object.assign(new Error('A valid bearer API key is required'), {
    status: 401,
    code: 'UNAUTHORIZED',
  });
}

export function createDemoApiKeyAuth(apiKeys) {
  return (request, response, next) => {
    const authorization = request.get('authorization');
    if (authorization === undefined) {
      next();
      return;
    }

    const match = /^Bearer\s+(\S+)$/i.exec(authorization);
    if (!match) {
      next(unauthorizedError());
      return;
    }

    const userId = apiKeys.get(match[1]);
    if (userId === undefined) {
      next(unauthorizedError());
      return;
    }

    request.auth = Object.freeze({ userId });
    next();
  };
}

export function requireAuthentication(request, response, next) {
  if (!request.auth) {
    next(unauthorizedError());
    return;
  }

  next();
}
