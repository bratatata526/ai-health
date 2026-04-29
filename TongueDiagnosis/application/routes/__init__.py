from .model_api import router_tongue_analysis

def register_routes(app):
    app.include_router(router_tongue_analysis, prefix="/api/model")
