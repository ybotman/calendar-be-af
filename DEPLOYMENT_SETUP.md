# Azure Functions Deployment Setup

## GitHub Actions Workflows Created

### TEST Environment
- **File**: `.github/workflows/azure-functions-test.yml`
- **Trigger**: Push to `TEST` branch
- **Target**: `calendar-be-af-test` Function App
- **Environment**: TEST

### PROD Environment  
- **File**: `.github/workflows/azure-functions-prod.yml`
- **Trigger**: Push to `PROD` branch
- **Target**: `calendar-be-af-prod` Function App
- **Environment**: PROD
- **Additional**: Runs lint checks before deployment

## Required GitHub Secrets

You need to add these secrets in your GitHub repository settings:

### For TEST Environment
- `AZURE_FUNCTIONAPP_TEST_PUBLISH_PROFILE`
  - Get from Azure Portal → Function App → Get publish profile

### For PROD Environment
- `AZURE_FUNCTIONAPP_PROD_PUBLISH_PROFILE`
  - Get from Azure Portal → Function App → Get publish profile

## Required Azure Function Apps

Create these Azure Function Apps if they don't exist:

1. **calendar-be-af-test** (TEST environment)
2. **calendar-be-af-prod** (PROD environment)

Both should be configured with:
- Runtime: Node.js 20
- OS: Linux or Windows
- Plan: Consumption or Premium

## Environment Variables for Timer Trigger

Set these in each Function App's Application Settings:

### Required for BTC Import Script
- `MONGODB_URI` or `DB_STRING`: MongoDB connection string
- `IMPORT_DATE_RANGE_OVERRIDE`: (Optional) Format: `YYYY-MM-DD,YYYY-MM-DD`

### Other environment variables as needed by simple-import.js script

## Deployment Flow

1. **DEVL** → Push to origin/DEVL
2. **TEST** → Merge DEVL to TEST, push to origin/TEST (triggers GitHub Action)
3. **PROD** → Merge TEST to PROD, push to origin/PROD (triggers GitHub Action)

## Timer Trigger Function

- **Function Name**: `btcImportFunction`
- **Schedule**: Daily at 4am UTC (`0 0 4 * * *`)
- **Script Called**: `node utils/btcImport/simple-import.js <startDate> <endDate>`
- **Date Calculation**: 
  - Start: today - 5 days
  - End: last day of (current month + 12 months)

## Testing

### Manual Trigger
1. Go to Azure Portal → Function App → Functions → btcImportFunction
2. Click "Test/Run" to trigger manually
3. Check logs for execution details

### Environment Override
Set `IMPORT_DATE_RANGE_OVERRIDE=2025-01-01,2025-01-31` for custom date range testing.

---

*Created: 2025-05-23*
*Feature: Feature_3001_TimerTriggerImportFunction*