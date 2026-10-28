@echo off
rem Construye la version de escritorio de Windows:
rem   dist\DiagramasElectricos\                       carpeta con DiagramasElectricos.exe (portable)
rem   dist\DiagramasElectricos-<version>-instalador.exe  instalador
rem Necesita Python 3.12 y, para el instalador, Inno Setup 6 (ISCC.exe) o Docker (imagen amake/innosetup).
chcp 65001 >nul
setlocal
cd /d "%~dp0.."
set VERSION=1.0.0

if not exist build\venv-win\Scripts\python.exe (
  python -m venv build\venv-win || exit /b 1
)
rem pywebview fijado: escritorio.py cambia su manejo de ventanas nuevas (on_new_window_request)
build\venv-win\Scripts\python -m pip install -q -r requirements.txt pyinstaller pywebview==6.2.1 || exit /b 1

rem Python "embeddable" oficial: ejecuta el simulador del ESP32 (ver runner_python() en simulador.py)
if not exist build\python-embed\python.exe (
  curl -fsSL -o build\python-embed.zip https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip || exit /b 1
  powershell -NoProfile -Command "Expand-Archive -Force build\python-embed.zip build\python-embed" || exit /b 1
)
build\venv-win\Scripts\python -m PyInstaller --noconfirm --clean --distpath dist --workpath build\pyinstaller-win empaquetado\diagramas.spec || exit /b 1

set ISCC=
for %%P in ("%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe" "%ProgramFiles%\Inno Setup 6\ISCC.exe" "%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe") do if exist %%P set ISCC=%%P
if defined ISCC (
  %ISCC% /DAppVersion=%VERSION% empaquetado\instalador.iss || exit /b 1
) else (
  echo Inno Setup no esta instalado: se usa Docker.
  docker run --rm -v "%cd%:/work" amake/innosetup /DAppVersion=%VERSION% empaquetado/instalador.iss || exit /b 1
)
echo.
echo Listo: dist\DiagramasElectricos-%VERSION%-instalador.exe
