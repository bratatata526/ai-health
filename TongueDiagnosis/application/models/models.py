from sqlalchemy import Column, Integer, String
from .database import Base


class AnalysisTask(Base):
    __tablename__ = 'AnalysisTask'
    id = Column(Integer, primary_key=True)
    task_id = Column(String(64), unique=True, index=True, nullable=False)
    status = Column(String(20), nullable=False)
    progress = Column(Integer, nullable=False, default=0)
    input_text = Column(String(2000), nullable=False, default='')
    image_path = Column(String(255), nullable=False)
    error = Column(String(2000), nullable=False, default='')
    result_json = Column(String, nullable=False, default='')
    created_at = Column(Integer, nullable=False)
    updated_at = Column(Integer, nullable=False)