# Vercel Deployment Guide for DegreeWorks Course Finder

## Prerequisites

1. **Vercel Account**: Sign up at [vercel.com](https://vercel.com)
2. **GitHub Repository**: Your code should be in a GitHub repository
3. **Anteater API Key**: Get your API key from [anteaterapi.com](https://anteaterapi.com)

## Changes Made for Vercel Compatibility

✅ **Configuration Files Added:**
- `vercel.json` - Vercel deployment configuration
- `requirements.txt` - Python dependencies (root level)
- `.vercelignore` - Files to exclude from deployment

✅ **Project Structure Updated:**
- Created `api/` directory with serverless functions
- Copied backend files to `api/` directory
- Updated frontend to use dynamic API URLs

✅ **Frontend API Configuration:**
- Updated `frontend/script.js` to automatically detect environment
- Uses `http://127.0.0.1:5000` for local development
- Uses `/api` for production (Vercel)

## Deployment Steps

### 1. Connect to Vercel

1. Go to [vercel.com](https://vercel.com) and sign in
2. Click "New Project"
3. Import your GitHub repository
4. Vercel will automatically detect it as a Python project

### 2. Configure Environment Variables

In your Vercel project settings:

1. Go to **Settings** → **Environment Variables**
2. Add the following variable:
   - **Name**: `ANTEATER_API_SECRET_KEY`
   - **Value**: Your API key from anteaterapi.com
   - **Environments**: Production, Preview, Development

### 3. Deploy

1. Click **Deploy** - Vercel will automatically:
   - Build your Python serverless functions from the `api/` directory
   - Serve your frontend files from the `frontend/` directory
   - Set up the routing as configured in `vercel.json`

### 4. Custom Domain (Optional)

1. Go to **Settings** → **Domains**
2. Add your custom domain
3. Update the canonical URL in `frontend/index.html` if needed

## File Structure After Changes

```
Degreeworks-Grabber/
├── api/                          # Serverless functions (backend)
│   ├── app.py                   # Main Flask application
│   ├── custom_execs.py          # Custom execution utilities
│   ├── schedule_builder.py      # Schedule building logic
│   └── complete_departments_list.txt
├── frontend/                     # Static frontend files
│   ├── index.html
│   ├── tutorial.html
│   ├── script.js               # Updated with dynamic API URLs
│   ├── styles.css
│   └── assets/
├── vercel.json                  # Vercel configuration
├── requirements.txt             # Python dependencies
├── .vercelignore               # Deployment exclusions
└── package.json                # Frontend dependencies (if any)
```

## Testing Your Deployment

### Local Testing
```bash
# Install Vercel CLI (if not installed)
npm i -g vercel

# Test locally
vercel dev
```

### Production Testing
After deployment, test these endpoints:
- `https://your-app.vercel.app/` - Frontend
- `https://your-app.vercel.app/api/health` - Backend health check (if available)

## Troubleshooting

### Common Issues:

1. **API Key Not Working**
   - Verify the environment variable is set correctly in Vercel
   - Check the variable name matches exactly: `ANTEATER_API_SECRET_KEY`

2. **Backend Errors**
   - Check Vercel function logs in the dashboard
   - Ensure all Python dependencies are in `requirements.txt`

3. **Frontend Can't Connect to Backend**
   - Verify the API URL logic in `frontend/script.js`
   - Check browser developer tools for CORS errors

4. **File Not Found Errors**
   - Ensure all required files are copied to the `api/` directory
   - Check that file paths in imports are relative

### Monitoring

- View deployment logs in Vercel dashboard
- Use Vercel's function logs for debugging backend issues
- Monitor the function execution time (Vercel has limits)

## Performance Considerations

- Vercel functions have a 10-second execution limit on the free plan
- Consider caching strategies for frequently requested data
- Optimize API calls to reduce response times

## Security Notes

- Never commit your `.env` file with real API keys
- Use Vercel's environment variables for all secrets
- Consider rate limiting if your API usage is high