import boto3
import os
from botocore.exceptions import ClientError

SES_REGION = os.getenv("AWS_REGION", "us-east-1")
FROM_EMAIL = os.getenv("FROM_EMAIL", "no-reply@yourdomain.com")

ses_client = boto3.client("ses", region_name=SES_REGION)


def send_password_reset_email(to_email: str, reset_token: str) -> bool:
    """Send password reset email via AWS SES"""
    
    # You'll need to update this URL to match your frontend
    reset_url = f"http://localhost:3000/reset-password?token={reset_token}"
    
    subject = "Password Reset Request"
    body_html = f"""
    <html>
    <head></head>
    <body>
      <h2>Password Reset Request</h2>
      <p>You requested a password reset. Click the link below to reset your password:</p>
      <p><a href="{reset_url}">Reset Password</a></p>
      <p>This link expires in 1 hour.</p>
      <p>If you didn't request this, ignore this email.</p>
    </body>
    </html>
    """
    
    body_text = f"""
    Password Reset Request
    
    You requested a password reset. Copy and paste this link to reset your password:
    {reset_url}
    
    This link expires in 1 hour.
    
    If you didn't request this, ignore this email.
    """
    
    try:
        response = ses_client.send_email(
            Source=FROM_EMAIL,
            Destination={"ToAddresses": [to_email]},
            Message={
                "Subject": {"Data": subject, "Charset": "UTF-8"},
                "Body": {
                    "Text": {"Data": body_text, "Charset": "UTF-8"},
                    "Html": {"Data": body_html, "Charset": "UTF-8"}
                }
            }
        )
        return True
    except ClientError as e:
        print(f"Error sending email: {e.response['Error']['Message']}")
        return False
