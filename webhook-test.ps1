$body = @{
  applicantId = "SUMSUB-TEST123"
  status      = "rejected"
  fullName    = "Test User"
  email       = "test@demo.com"
  pep         = $false
  amlScore    = 10
} | ConvertTo-Json

Invoke-RestMethod -Method Post `
  -Uri "https://policyflow-ai-app-linux-a8gacvecbdhxgpdx.uksouth-01.azurewebsites.net/api/webhook/sumsub" `
  -ContentType "application/json" `
  -Body $body
