<?php
header('Content-Type: application/json');

function jsonResponse($data, $status = 200)
{
    http_response_code($status);
    echo json_encode($data);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    jsonResponse(["error" => "Method not allowed"], 405);
}

// Read JSON payload
$json = file_get_contents('php://input');
$data = json_decode($json, true);

if (!$data) {
    jsonResponse(["error" => "Invalid JSON payload"], 400);
}

$name = isset($data['name']) ? trim($data['name']) : '';
$email = isset($data['email']) ? trim($data['email']) : '';
$subject = isset($data['subject']) ? trim($data['subject']) : 'No Subject';
$message = isset($data['message']) ? trim($data['message']) : '';

// Validation
if (empty($name) || empty($email) || empty($message)) {
    jsonResponse(["error" => "Name, email, and message are required"], 400);
}

if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    jsonResponse(["error" => "Invalid email format"], 400);
}

// Prepare email
<<<<<<< HEAD
$to = "name@example.com";
=======
$to = "maeacademy2026@gmail.com";
>>>>>>> 4f7e91afe2b1fe9a35de04dbe3b4df8176d5a1eb
$email_subject = "New Contact Message from {$name}";

$email_body = "Name: {$name}\n";
$email_body .= "Email: {$email}\n";
$email_body .= "Subject: {$subject}\n\n";
$email_body .= "Message:\n{$message}\n";

$headers = "From: {$email}\r\n";
$headers .= "Reply-To: {$email}\r\n";
$headers .= "X-Mailer: PHP/" . phpversion();

// Send email
$mailSent = @mail($to, $email_subject, $email_body, $headers);

if ($mailSent) {
    jsonResponse([
        "success" => true,
        "message" => "Message sent successfully ✅"
    ], 200);
}
else {
    jsonResponse(["error" => "Failed to send message. Please try again later."], 500);
}
?>
