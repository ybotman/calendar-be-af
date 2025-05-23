const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

/**
 * Calculate date range for BTC import
 * Start: today - 5 days
 * End: last day of (current month + 12 months)
 * @returns {Object} Object with startDate and endDate in YYYY-MM-DD format
 */
function calculateDateRange() {
    const today = new Date();
    
    // Start: today - 5 days
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - 5);
    
    // End: last day of (current month + 12 months)
    const endDate = new Date(today);
    endDate.setMonth(today.getMonth() + 12);
    endDate.setDate(1); // First day of target month
    endDate.setDate(0); // Last day of previous month (which is our target)
    
    return {
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0]
    };
}

/**
 * Parse ENV override for date range
 * @param {string} override - Format: "YYYY-MM-DD,YYYY-MM-DD"
 * @returns {Object|null} Object with startDate and endDate or null if invalid
 */
function parseEnvOverride(override) {
    if (!override || typeof override !== 'string') {
        return null;
    }
    
    const parts = override.split(',');
    if (parts.length !== 2) {
        return null;
    }
    
    const [startDate, endDate] = parts.map(date => date.trim());
    
    // Basic validation for YYYY-MM-DD format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
        return null;
    }
    
    return { startDate, endDate };
}

module.exports = async function (context, myTimer) {
    context.log('TimerTriggerImportFunction started at', new Date().toISOString());
    
    try {
        // Determine date range (ENV override or calculated)
        const override = process.env.IMPORT_DATE_RANGE_OVERRIDE;
        let dateRange;
        
        if (override) {
            dateRange = parseEnvOverride(override);
            if (dateRange) {
                context.log(`Using ENV override dates: ${dateRange.startDate} to ${dateRange.endDate}`);
            } else {
                context.log.warn(`Invalid ENV override format: "${override}". Using calculated dates instead.`);
                dateRange = calculateDateRange();
            }
        } else {
            dateRange = calculateDateRange();
            context.log(`Using calculated dates: ${dateRange.startDate} to ${dateRange.endDate}`);
        }
        
        // Execute the import script
        const command = `node utils/btcImport/simple-import.js ${dateRange.startDate} ${dateRange.endDate}`;
        context.log('Executing command:', command);
        
        // Use promisified exec to properly await completion
        const { stdout, stderr } = await execAsync(command, {
            cwd: process.cwd(),
            timeout: 300000, // 5 minute timeout
            maxBuffer: 1024 * 1024 * 10 // 10MB buffer for output
        });
        
        // Log script output
        if (stdout) {
            context.log('Script stdout:', stdout);
        }
        
        if (stderr) {
            context.log.warn('Script stderr:', stderr);
        }
        
        context.log('TimerTriggerImportFunction completed successfully at', new Date().toISOString());
        
    } catch (error) {
        context.log.error('TimerTriggerImportFunction failed:', error.message);
        
        // Log additional error details if available
        if (error.stdout) {
            context.log.error('Error stdout:', error.stdout);
        }
        if (error.stderr) {
            context.log.error('Error stderr:', error.stderr);
        }
        if (error.code) {
            context.log.error('Exit code:', error.code);
        }
        
        // Don't throw - let the function complete so Azure Functions doesn't retry immediately
        // The timer will trigger again on the next scheduled run
    }
};
