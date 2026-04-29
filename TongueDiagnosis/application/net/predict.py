import queue
import tempfile
import base64
import io
import time
import torch
from PIL import Image
import numpy as np
from yolov5 import load
from segment_anything import sam_model_registry,SamPredictor
from application.net.model.resnet import ResNetPredictor


class TonguePredictor:
    _instance = None
    _initialized = False

    def __new__(cls, *args, **kwargs):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self,
                 yolo_path='application/net/weights/yolov5.pt',
                 sam_path='application/net/weights/sam_vit_b_01ec64.pth',
                 resnet_path=[
                     'application/net/weights/tongue_color.pth',
                     'application/net/weights/tongue_coat_color.pth',
                     'application/net/weights/thickness.pth',
                     'application/net/weights/rot_and_greasy.pth'
                 ]
                 ):
        if self._initialized:
            return
        self.device = torch.device('cpu')
        self.yolo = load(yolo_path, device='cpu')
        self.sam = sam_model_registry["vit_b"](checkpoint=sam_path)
        self.resnet = ResNetPredictor(resnet_path)
        self.queue = queue.Queue()
        TonguePredictor._initialized = True

    def analyze_image(self, img):
        try:
            img.seek(0)
            return self.__predict(img)
        except Exception as e:
            print(e)
            return {
                "code": 203,
                "error": str(e)
            }

    def __predict(self, img):
        total_start = time.time()
        predict_img = Image.open(img)
        self.yolo.eval()

        t0 = time.time()
        print("[Step 1/4] Tongue positioning...")
        with torch.no_grad():
            pred = self.yolo(predict_img)
        t1 = time.time()
        print(f"[Step 1/4] Tongue positioning done in {t1-t0:.2f}s")

        if len(pred.xyxy[0]) < 1:
            print("The picture is not legal and has no tongue.")
            return {
                "code": 201,
                "message": "No tongue detected"
            }
        elif len(pred.xyxy[0]) > 1:
            print("The picture is not legal. There are too many tongues.")
            return {
                "code": 202,
                "message": "Multiple tongues detected"
            }

        t2 = time.time()
        print("[Step 2/4] Tongue segmentation...")
        with torch.no_grad():
            x1, y1, x2, y2 = (
                pred.xyxy[0][0, 0].item(), pred.xyxy[0][0, 1].item(), pred.xyxy[0][0, 2].item(),
                pred.xyxy[0][0, 3].item())
            predictor = SamPredictor(sam_model=self.sam)
            predictor.set_image(np.array(predict_img))
            masks, _, _ = predictor.predict(box=np.array([x1, y1, x2, y2]))
            original_img = np.array(predict_img)
            masks = np.transpose(masks, (1,2,0))
            pred = original_img * masks
            result = Image.fromarray(pred).crop((x1, y1, x2, y2)).convert("RGB")
            result = np.array(result)
            segmented_image = Image.fromarray(result)
            buffer = io.BytesIO()
            segmented_image.save(buffer, format="PNG")
            segmented_image_base64 = base64.b64encode(buffer.getvalue()).decode("utf-8")
        t3 = time.time()
        print(f"[Step 2/4] Tongue segmentation done in {t3-t2:.2f}s")

        print("[Step 3/4] ResNet feature extraction...")
        result = self.resnet.predict(result)
        t4 = time.time()
        print(f"[Step 3/4] ResNet feature extraction done in {t4-t3:.2f}s")

        print("[Step 4/4] Building result...")
        predict_result = {
            "code": 0,
            'tongue_color': result[0],
            'tongue_coat_color': result[1],
            'thickness': result[2],
            'rot_and_greasy': result[3],
            'segmented_image_base64': segmented_image_base64
        }

        total_time = time.time() - total_start
        print(f"[Total] All steps completed in {total_time:.2f}s")
        return predict_result

    def predict(self, img, record_id, fun):
        try:
            img.seek(0)
            tmpfile = tempfile.SpooledTemporaryFile()
            content = img.read()
            tmpfile.write(content)
            self.queue.put((tmpfile, record_id, fun))
            img.seek(0)
            return {"code": 0}
        except Exception as e:
            return {"code": 3}

    def main(self):
        while True:
            if self.queue.empty():
                continue
            img, record_id, fun = self.queue.get()
            try:
                result = self.__predict(img)
                if result["code"] == 0:
                    fun(event_id=record_id,
                        tongue_color=result['tongue_color'],
                        coating_color=result['tongue_coat_color'],
                        tongue_thickness=result['thickness'],
                        rot_greasy=result['rot_and_greasy'],
                        code=1)
                else:
                    fun(event_id=record_id,
                        tongue_color=None,
                        coating_color=None,
                        tongue_thickness=None,
                        rot_greasy=None,
                        code=result["code"])
            except Exception as e:
                print(e)
                fun(event_id=record_id,
                    tongue_color=None,
                    coating_color=None,
                    tongue_thickness=None,
                    rot_greasy=None,
                    code=203)
            finally:
                img.close()
