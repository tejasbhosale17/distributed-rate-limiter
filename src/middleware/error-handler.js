export function createErrorHandler({ logger }) {
  return (error, request, response, next) => {
    if (response.headersSent) {
      next(error);
      return;
    }

    const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 500
      ? error.status
      : 500;

    logger.error({
      err: error,
      requestId: request.id,
      status,
    }, 'Request failed');

    response.status(status).json({
      error: {
        code: status === 500 ? 'INTERNAL_SERVER_ERROR' : (error.code ?? 'BAD_REQUEST'),
        message: status === 500 ? 'An unexpected error occurred' : error.message,
      },
      requestId: request.id,
      instanceId: request.app.locals.instanceId,
    });
  };
}
