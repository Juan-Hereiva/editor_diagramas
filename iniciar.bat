@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Instalando dependencias...
python -m pip install -q -r requirements.txt
echo.
echo Abriendo http://localhost:5000  (cierra esta ventana para detener el servidor)
start "" cmd /c "timeout /t 2 >nul & start http://localhost:5000"
python app.py
pause
