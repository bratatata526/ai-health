import threading
import uvicorn
from application import create_app
from application.net.predict import TonguePredictor
from application.config import settings
from application.models.database import Base, engine
from application.models import models

app = create_app()
if __name__ == '__main__':
    Base.metadata.create_all(bind=engine)
    tonguePredictor = TonguePredictor()
    threading.Thread(target=tonguePredictor.main).start()
    uvicorn.run(app, host="0.0.0.0", port=settings.APP_PORT)
