@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 goto :missing_node

where npm >nul 2>&1
if errorlevel 1 goto :missing_node

if not exist "node_modules" (
    echo [안내] node_modules 폴더가 없어 패키지를 설치합니다...
    call npm install
    if errorlevel 1 goto :run_error
)

echo ==================================================
echo   중학 한자 공부 로컬 테스트 서버를 시작합니다
echo ==================================================
echo   - 로컬 접속 주소 : http://localhost:5173
echo   - 모바일 접속    : 같은 Wi-Fi 환경에서 아래 Vite의
echo                      Network 주소를 입력하면 접속됩니다
echo   - 종료 방법      : Ctrl + C 입력 또는 창 닫기
echo ==================================================
echo.

call npm run dev -- --open --host
if errorlevel 1 goto :run_error
goto :end

:missing_node
echo [오류] Node.js 또는 npm을 찾을 수 없습니다.
echo Node.js를 설치한 뒤 다시 실행해 주세요.
echo 다운로드: https://nodejs.org/
pause
exit /b 1

:run_error
echo.
echo [오류] 로컬 테스트 서버 실행 중 문제가 발생했습니다.
echo 위의 오류 메시지를 확인한 뒤 다시 시도해 주세요.
pause
exit /b 1

:end
endlocal
