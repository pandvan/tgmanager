import logging
from configuration import Config
from aiohttp import web
from .routes import routes
from aiohttp_basicauth import BasicAuthMiddleware


logger = logging.getLogger("WEB")

def web_server():
  logger.debug("Initializing..")
  if Config.http.user and Config.http.password:
    auth = BasicAuthMiddleware(username = Config.http.user, password = Config.http.password)
    web_app = web.Application(middlewares=[auth], client_max_size=100 * 1024 * 1024 * 1024)
  else:
    web_app = web.Application(client_max_size=100 * 1024 * 1024 * 1024)
  web_app.add_routes(routes)
  logger.info("Started")
  return web_app