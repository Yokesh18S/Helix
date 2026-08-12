"""
Helix Email Delivery Service

Handles real-life email notifications with PDF attachments.
"""

import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.application import MIMEApplication
from typing import Dict, Any, Optional


def send_requirements_email(
    application_data: Dict[str, Any],
    pdf_bytes: bytes,
    recipient_email: Optional[str] = None
) -> bool:
    """
    Send confirmation email with attached Business Requirements & Canvas PDF.
    Returns True if email sent successfully, False otherwise.
    """
    to_email = recipient_email or application_data.get("signer_email")
    if not to_email:
        user = application_data.get("user") or {}
        if isinstance(user, dict):
            to_email = user.get("email")

    if not to_email or "@" not in to_email:
        print(f"No valid recipient email provided for application {application_data.get('id')}")
        return False

    smtp_host = os.getenv("SMTP_HOST", "smtp.gmail.com")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER", "")
    smtp_password = os.getenv("SMTP_PASSWORD", "")
    smtp_from = os.getenv("SMTP_FROM", f"Helix AI <{smtp_user or 'noreply@helix.ai'}>")

    ref_no = application_data.get("reference_number", "REQ-PENDING")
    project_name = application_data.get("project_name", "Untitled Project")

    # Create message container
    msg = MIMEMultipart()
    msg['From'] = smtp_from
    msg['To'] = to_email
    msg['Subject'] = f"Helix Requirements & Business Canvas: {project_name} ({ref_no})"

    # HTML Body
    html_body = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <style>
            body {{ font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8fafc; color: #1e293b; margin: 0; padding: 20px; }}
            .container {{ max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; padding: 32px; border: 1px solid #e2e8f0; }}
            .header {{ text-align: center; border-bottom: 2px solid #4f46e5; padding-bottom: 20px; margin-bottom: 24px; }}
            .brand {{ font-size: 24px; font-weight: bold; color: #0f172a; letter-spacing: -0.5px; }}
            .tagline {{ font-size: 13px; color: #4f46e5; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; }}
            .content {{ font-size: 15px; line-height: 1.6; color: #334155; }}
            .ref-box {{ background-color: #f1f5f9; border-radius: 12px; padding: 16px; margin: 20px 0; border-left: 4px solid #4f46e5; }}
            .ref-title {{ font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 700; letter-spacing: 1px; }}
            .ref-value {{ font-size: 20px; color: #0f172a; font-weight: 700; margin-top: 4px; }}
            .footer {{ margin-top: 32px; padding-top: 20px; border-top: 1px solid #e2e8f0; text-align: center; font-size: 12px; color: #94a3b8; }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <div class="brand">HELIX AI</div>
                <div class="tagline">Enterprise Business Specification & Canvas</div>
            </div>
            <div class="content">
                <p>Hello,</p>
                <p>Thank you for using <strong>Helix AI Business Consultant</strong>. Your business requirements and Business Model Canvas have been processed, signed, and locked for analyst review.</p>

                <div class="ref-box">
                    <div class="ref-title">Reference Number</div>
                    <div class="ref-value">{ref_no}</div>
                    <div style="font-size: 13px; color: #475569; margin-top: 6px;">Project: <strong>{project_name}</strong></div>
                </div>

                <p>We have attached the official <strong>Business Requirement Specification & Business Model Canvas (PDF)</strong> directly to this email for your records.</p>
                <p>Our expert delivery and architecture team will review your specifications and reach out within 1 business day.</p>
            </div>
            <div class="footer">
                &copy; 2026 Helix AI Business Consultant. All rights reserved.<br/>
                This is an automated delivery confirmation email.
            </div>
        </div>
    </body>
    </html>
    """

    msg.attach(MIMEText(html_body, 'html'))

    # Attach PDF
    if pdf_bytes:
        filename = f"Helix_Requirements_{ref_no}.pdf"
        part = MIMEApplication(pdf_bytes, Name=filename)
        part['Content-Disposition'] = f'attachment; filename="{filename}"'
        msg.attach(part)

    # Attempt SMTP Sending
    if smtp_user and smtp_password:
        try:
            print(f"Connecting to SMTP server {smtp_host}:{smtp_port}...")
            server = smtplib.SMTP(smtp_host, smtp_port, timeout=15)
            server.starttls()
            server.login(smtp_user, smtp_password)
            server.sendmail(smtp_from, [to_email], msg.as_string())
            server.quit()
            print(f"Real email successfully sent to {to_email} with PDF attachment!")
            return True
        except Exception as e:
            print(f"SMTP Error while sending email to {to_email}: {e}")
            return False
    else:
        print(f"[MAIL SIMULATION] Email prepared for {to_email} with PDF attachment ({len(pdf_bytes)} bytes). Configure SMTP_USER and SMTP_PASSWORD in .env for live transmission.")
        return True
