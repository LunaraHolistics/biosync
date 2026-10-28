$envContent = Get-Content ".env" -ErrorAction Stop
$secretLine = $envContent | Where-Object { $_ -match '^APP_SECRET_KEY=' }
$secretKey = ($secretLine -replace '^APP_SECRET_KEY=', '').Trim().Trim('"').Trim("'")

Write-Host "Usando APP_SECRET_KEY com tamanho: $($secretKey.Length)" -ForegroundColor Cyan

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
        resumo = "Teste de integração"
        total_problemas = 2
        score = 75
        setores = @("fisico", "emocional")
    }
    plano_terapeutico = @()
    pontos_criticos = @("Vitamina D", "Cortisol")
    indice_biosync = @{
        score = 75
        nivel = "Atenção"
    }
    status = "processado"
} | ConvertTo-Json -Depth 5 -Compress

$headers = @{
    "Content-Type" = "application/json"
    "x-api-key" = $secretKey
}

Write-Host "`nEnviando POST para http://localhost:3000/api/exames ..." -ForegroundColor Yellow

try {
    $response = Invoke-RestMethod -Uri "http://localhost:3000/api/exames" `
        -Method POST `
        -Headers $headers `
        -Body $body
    Write-Host "`n=== SUCESSO ===" -ForegroundColor Green
    $response | ConvertTo-Json -Depth 5
} catch {
    Write-Host "`n=== ERRO ===" -ForegroundColor Red
    Write-Host "Status: $($_.Exception.Response.StatusCode)" -ForegroundColor Red
    $reader = [System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream())
    $reader.ReadToEnd()
}