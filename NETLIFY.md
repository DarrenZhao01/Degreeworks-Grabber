# Deploying to Netlify

This guide explains how to deploy the DegreeWorks Course Finder to Netlify.

## Prerequisites

- A GitHub repository with your code
- A Netlify account
- An Anteater API key

## Steps for Deployment

1. **Connect your GitHub repository to Netlify**:
   - Log in to Netlify
   - Click "New site from Git"
   - Choose GitHub as your Git provider and authorize Netlify
   - Select your repository

2. **Configure build settings**:
   - **Branch to deploy**: `main` (or your preferred branch)
   - **Base directory**: Leave blank (use root)
   - **Build command**: `npm run build`
   - **Publish directory**: `public`
   - **Functions directory**: `netlify/functions`

3. **Set up environment variables**:
   - Go to Site settings > Environment variables
   - Add `ANTEATER_API_SECRET_KEY` with your API key

4. **Deploy your site**:
   - Click "Deploy site"
   - Wait for the build to complete

## How It Works

This deployment creates:

1. A static frontend in the `public` directory
2. A serverless function at `/.netlify/functions/stream_process` to handle API requests

The JavaScript in the frontend has been modified to call the Netlify function instead of the Flask endpoint.

## Troubleshooting

- If the API calls fail, check that your environment variable is correctly set
- If the build fails, check the build logs for errors
- If the site deploys but doesn't work, check the browser console for errors

## Local Development

To test locally:

```bash
# Install netlify CLI
npm install -g netlify-cli

# Install dependencies
npm install

# Run locally
netlify dev
``` 