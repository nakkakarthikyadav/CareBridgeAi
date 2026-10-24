import io
import os
import re
import base64
import requests
from pypdf import PdfReader
from PIL import Image, ImageEnhance, ImageOps

MAX_FILE_SIZE_MB = 10
ALLOWED_EXTENSIONS = {"pdf", "png", "jpg", "jpeg"}

def validate_uploaded_file(uploaded_file):
    """
    Validates file type and file size.
    Returns: (is_valid: bool, message: str)
    """
    if uploaded_file is None:
        return False, "No file uploaded."
    
    # 1. Check extension
    filename = uploaded_file.name.lower()
    file_ext = filename.rsplit(".", 1)[-1] if "." in filename else ""
    if file_ext not in ALLOWED_EXTENSIONS:
        return False, f"Unsupported file type (.{file_ext}). Please upload a PDF, PNG, JPG, or JPEG."
    
    # 2. Check file size (in MB)
    file_size_mb = uploaded_file.size / (1024 * 1024)
    if file_size_mb > MAX_FILE_SIZE_MB:
        return False, f"File is too large ({file_size_mb:.1f} MB). Maximum allowed size is {MAX_FILE_SIZE_MB} MB."
    
    return True, f"File valid: {uploaded_file.name} ({file_size_mb:.2f} MB)"

def extract_text_from_pdf(pdf_bytes):
    """
    Extracts embedded text from a PDF file.
    Returns: (text: str, success: bool, message: str)
    """
    try:
        reader = PdfReader(io.BytesIO(pdf_bytes))
        if len(reader.pages) == 0:
            return "", False, "The uploaded PDF is empty."
        
        extracted_pages = []
        for idx, page in enumerate(reader.pages):
            page_text = page.extract_text() or ""
            if page_text.strip():
                extracted_pages.append(f"--- Page {idx + 1} ---\n{page_text.strip()}")
        
        full_text = "\n\n".join(extracted_pages).strip()
        if not full_text:
            return "", False, "No readable digital text found in this PDF. It may be a scanned image."
        
        return full_text, True, "Successfully extracted text from PDF."
    except Exception as e:
        return "", False, f"Error reading PDF: {str(e)}"

def preprocess_handwritten_image(image_bytes: bytes) -> bytes:
    """
    Enhances contrast, grayscale, and sharpness of handwritten prescriptions
    to make ink legible against paper grain and shadows.
    """
    try:
        img = Image.open(io.BytesIO(image_bytes))
        if img.mode != "RGB":
            img = img.convert("RGB")
        # Increase contrast to make faint ink stand out
        enhancer = ImageEnhance.Contrast(img)
        img = enhancer.enhance(1.6)
        # Increase sharpness for cursive edges
        sharpener = ImageEnhance.Sharpness(img)
        img = sharpener.enhance(1.4)
        out_buf = io.BytesIO()
        img.save(out_buf, format="JPEG", quality=92)
        return out_buf.getvalue()
    except Exception:
        return image_bytes

def extract_text_from_image(image_bytes):
    """
    Extracts text from an image using OCR (Tesseract).
    Returns: (text: str, success: bool, message: str)
    """
    try:
        import pytesseract
        
        if os.name == "nt":
            windows_paths = [
                r"C:\Program Files\Tesseract-OCR\tesseract.exe",
                r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
                os.path.expanduser(r"~\AppData\Local\Programs\Tesseract-OCR\tesseract.exe")
            ]
            for wp in windows_paths:
                if os.path.exists(wp):
                    pytesseract.pytesseract.tesseract_cmd = wp
                    break

        image = Image.open(io.BytesIO(image_bytes))
        
        try:
            text = pytesseract.image_to_string(image).strip()
            if not text:
                return "", False, "OCR completed, but no text could be recognized in this image."
            return text, True, "Successfully extracted text using OCR."
        except (pytesseract.TesseractNotFoundError, FileNotFoundError):
            return "", False, (
                "Tesseract OCR engine is not installed on this system. "
                "You can still view the image and type or paste the text directly into the editor below."
            )
        except Exception as ocr_err:
            return "", False, f"OCR processing failed: {str(ocr_err)}"
    except Exception as img_err:
        return "", False, f"Invalid or unreadable image file: {str(img_err)}"

def extract_handwriting_with_gemini_vision(image_bytes: bytes, api_key: str = None):
    """
    Deciphers doctor handwriting, cursive prescriptions, and clinical notes
    using Gemini Multimodal Vision API with image contrast enhancement.
    """
    key = api_key or os.getenv("GEMINI_API_KEY")
    if not key or key.strip() == "your_gemini_api_key_here":
        return "", False, "A Gemini API Key is required for live AI Vision handwriting deciphering. Enter your key in the sidebar or upload page."
    
    try:
        enhanced_bytes = preprocess_handwritten_image(image_bytes)
        b64_image = base64.b64encode(enhanced_bytes).decode("utf-8")
        
        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={key.strip()}"
        
        prompt = """You are a senior clinical pharmacist and medical transcription specialist.
Decipher this handwritten doctor's prescription or clinical note image with utmost care.
Doctor handwriting is often hurried, cursive, and difficult for patients to read.

Instructions:
1. Identify and transcribe clinic/hospital name, doctor's name, patient name, and date if visible.
2. Transcribe ALL prescribed medications:
   - Medicine name (trade/brand name and generic equivalent)
   - Strength / dosage (e.g. 100mg, 50mg, 10mg)
   - Frequency & Timing (e.g., BID/twice daily, TID/thrice daily, QD/once daily, before/after meals)
   - Duration of course
3. Transcribe diet, lifestyle, activity, and wound care instructions.
4. Transcribe follow-up appointments and emergency warning red flags.
5. IF ANY WRITING OR MEDICINE NAME IS ILLEGIBLE, BLURRED, OR AMBIGUOUS:
   Explicitly mark it as: "[Illegible / Unclear handwriting - Requires Pharmacist Confirmation]". Never fabricate or guess unreadable drugs.
Format clearly in plain patient-friendly text with clear sections."""

        payload = {
            "contents": [
                {
                    "parts": [
                        {"text": prompt},
                        {
                            "inlineData": {
                                "mimeType": "image/jpeg",
                                "data": b64_image
                            }
                        }
                    ]
                }
            ],
            "generationConfig": {
                "temperature": 0.2
            }
        }
        
        resp = requests.post(url, headers={"Content-Type": "application/json"}, json=payload, timeout=25)
        resp.raise_for_status()
        data = resp.json()
        
        text = data["candidates"][0]["content"]["parts"][0]["text"].strip()
        if not text:
            return "", False, "AI Vision completed but returned empty text."
        return text, True, "Successfully deciphered doctor handwriting with Gemini AI Vision!"
    except Exception as e:
        return "", False, f"AI Vision error: {str(e)}"
