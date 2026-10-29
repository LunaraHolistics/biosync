# teste-exames.ps1

$ErrorActionPreference = "Stop"

$vars = @{}

Get-Content .env | ForEach-Object {
    if ($_ -match '^\s*([^=]+)=(.*)$') {
        $name = $matches[1].Trim()
        $value = $matches[2].Trim().Trim('"').Trim("'")
        $vars[$name] = $value
    }
}

$secretKey = $vars["APP_SECRET_KEY"]

if (-not $secretKey) {
    Write-Host "ERRO: APP_SECRET_KEY nao encontrada no .env" -ForegroundColor Red
    exit 1
}

Write-Host "APP_SECRET_KEY carregada. Tamanho: $($secretKey.Length)" -ForegroundColor Cyan

$body = @{
    nome_paciente = "TESTE LOCAL CELSO"
    data_exame = "2026-10-28"
    resultado_json = @{
        problemas = @(
            @{ item = "Vitamina D"; valor = "18"; status = "Baixo" }
            @{ item = "Cortisol"; valor = "28"; status = "Alto" }
        )
    }
    analise_ia = @{
        resumo = "Teste de integracao local"
        total_problemas = 2
        score = 75
        setores = @("fisico", "emocional")
        matches = 2
    }
    indice_biosync = @{
        score = 75
        nivel = "Atencao"
        setores = @("fisico", "emocional")
    }
    plano_terapeutico = @()
    pontos_criticos = @("Vitamina D", "Cortisol")
    status = "processado"
} | ConvertTo-Json -Depth 5 -Compress

$headers = @{
    "Content-Type" = "application/json"
    "x-api-key" = $secretKey
}

Write-Host "`n=== TESTE 1: POST http://localhost:3000/api/exames ===" -ForegroundColor Yellow

try {
    $response = Invoke-RestMethod -Uri "http://localhost:3000/api/exames" `
        -Method POST `
        -Headers $headers `
        -Body $body

    Write-Host "`n✅ SUCESSO" -ForegroundColor Green
    $response | ConvertTo-Json -Depth 5
} catch {
    Write-Host "`n❌ ERRO NO POST /api/exames" -ForegroundColor Red
    Write-Host "Status: $($_.Exception.Response.StatusCode)" -ForegroundColor Red

    try {
        $reader = [System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream())
        $reader.BaseStream.Position = 0
        $reader.DiscardBufferedData()
        $bodyErr = $reader.ReadToEnd()
        Write-Host $bodyErr
    } catch {
        Write-Host "Não foi possível ler o corpo do erro."
    }
}

Write-Host "`n=== TESTE 2: GET http://localhost:3000/health ===" -ForegroundColor Yellow

try {
    $health = Invoke-RestMethod -Uri "http://localhost:3000/health"
    $health | ConvertTo-Json -Depth 3
} catch {
    Write-Host "❌ Falha no /health: $_" -ForegroundColor Red
}

Write-Host "`n=== TESTE 3: GET http://localhost:3000/api/exames?limit=3 ===" -ForegroundColor Yellow

try {
    $list = Invoke-RestMethod -Uri "http://localhost:3000/api/exames?limit=3" `
        -Headers @{ "x-api-key" = $secretKey }

    Write-Host "✅ Total de exames: $($list.total)" -ForegroundColor Green

    $list.exames | Select-Object -First 3 | ForEach-Object {
        Write-Host "  - $($_.nome_paciente) | $($_.data_exame) | $($_.status)"
    }
} catch {
    Write-Host "❌ Falha ao listar exames: $_" -ForegroundColor Red

    try {
        $reader = [System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream())
        $reader.BaseStream.Position = 0
        $reader.DiscardBufferedData()
        Write-Host $reader.ReadToEnd()
    } catch {}
}