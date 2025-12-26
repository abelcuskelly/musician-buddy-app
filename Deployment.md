
# AI Musician Buddy: Deployment Guide

This guide walks you through deploying the AI Musician Buddy application to Google Cloud Run, making it a publicly accessible and scalable web service.

We are deploying a full-stack application. A Node.js backend serves the React frontend and acts as a secure proxy for Gemini API calls. This is crucial to protect your `API_KEY`, which should never be exposed in frontend code.

## Prerequisites

1.  **Google Cloud SDK (`gcloud`)**: [Install and initialize the gcloud CLI](https://cloud.google.com/sdk/docs/install).
2.  **Docker**: [Install Docker Desktop](https://www.docker.com/products/docker-desktop/). It must be running for local builds if you choose not to use Cloud Build.
3.  **Google Cloud Project**:
    *   Create a new project in the [Google Cloud Console](https://console.cloud.google.com/).
    *   Ensure billing is enabled for your project.
4.  **Enable APIs**: Enable the following APIs for your project. You can do this by running the `gcloud services enable` command or via the Cloud Console.

    ```bash
    gcloud services enable \
      run.googleapis.com \
      cloudbuild.googleapis.com \
      artifactregistry.googleapis.com \
      secretmanager.googleapis.com \
      iam.googleapis.com
    ```

## Deployment Steps

### Step 1: Store API Key in Secret Manager

First, securely store your Gemini API key in Google Cloud's Secret Manager.

1.  **Create a secret:**
    ```bash
    gcloud secrets create musician-buddy-api-key --replication-policy="automatic"
    ```

2.  **Add the key value as a secret version:** Replace `YOUR_API_KEY_HERE` with your actual key.
    ```bash
    printf "YOUR_API_KEY_HERE" | gcloud secrets versions add musician-buddy-api-key --data-file=-
    ```

3.  **Grant Access to Cloud Run:** Give your Cloud Run service account permission to access the secret.
    *(Note: You'll run this command after the first (potentially failed) deployment attempt, or if you know your project number).*
    ```bash
    # Replace PROJECT_NUMBER with your actual GCP project number.
    # You can find it by running `gcloud projects describe PROJECT_ID --format='value(projectNumber)'`
    PROJECT_NUMBER=$(gcloud projects describe $(gcloud config get-value project) --format='value(projectNumber)')
    gcloud secrets add-iam-policy-binding musician-buddy-api-key \
      --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
      --role="roles/secretmanager.secretAccessor"
    ```

### Step 2: Build and Push the Container Image

We will use Google Cloud Build to build the Docker image from the `Dockerfile` in this project and push it to the Artifact Registry.

1.  **Create an Artifact Registry repository** (if you don't have one):
    ```bash
    # Replace YOUR_REGION with a region like 'us-central1'
    gcloud artifacts repositories create musician-buddy-repo \
      --repository-format=docker \
      --location=YOUR_REGION \
      --description="Docker repository for Musician Buddy"
    ```

2.  **Build the image using Cloud Build:** This command builds the image and tags it within Artifact Registry.
    ```bash
    # Replace YOUR_REGION and YOUR_PROJECT_ID
    gcloud builds submit --tag YOUR_REGION-docker.pkg.dev/YOUR_PROJECT_ID/musician-buddy-repo/musician-buddy
    ```

### Step 3: Deploy to Cloud Run

Now, deploy the container image to Cloud Run. This will create a public HTTPS endpoint for your application.

```bash
# Replace YOUR_REGION and YOUR_PROJECT_ID
gcloud run deploy musician-buddy-service \
  --image=YOUR_REGION-docker.pkg.dev/YOUR_PROJECT_ID/musician-buddy-repo/musician-buddy \
  --platform=managed \
  --region=YOUR_REGION \
  --allow-unauthenticated \
  --set-secrets="API_KEY=musician-buddy-api-key:latest"
```

**Command Breakdown:**
*   `gcloud run deploy musician-buddy-service`: Deploys a service named `musician-buddy-service`.
*   `--image`: Specifies the container image we just built.
*   `--platform=managed`: Uses the fully managed Cloud Run environment.
*   `--region`: Deploys the service to your specified region.
*   `--allow-unauthenticated`: Makes the web app public.
*   `--set-secrets`: This securely mounts the secret we created in Step 1 as an environment variable named `API_KEY` inside our running container.

### Step 4: Access Your App!

After the deployment command succeeds, it will output a **Service URL**. Visit this URL in your browser to use your live AI Musician Buddy application!
