@echo off
cd /d "C:\Program Files\MySQL\MySQL Server 9.6\bin"

mysql.exe -u root -p -e "CREATE DATABASE IF NOT EXISTS loja_escoteira;"

if errorlevel 1 (
    echo Erro ao criar ou verificar o banco.
    exit /b 1
)

echo Banco criado ou verificado com sucesso.
pause
