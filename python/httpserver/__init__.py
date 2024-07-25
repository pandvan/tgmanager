import logging
from aiohttp import web
from .routes import routes

logger = logging.getLogger("WEB")

def web_server():
  logger.debug("Initializing..")
  web_app = web.Application(client_max_size=100 * 1024 * 1024 * 1024)
  web_app.add_routes(routes)
  logger.info("Started")
  return web_app