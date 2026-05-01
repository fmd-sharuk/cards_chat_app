import hashlib


def generate_cards_sbox(key: bytes):
    deck = list(range(256))
    key_stream = hashlib.sha256(key).digest()

    j = 0
    for i in range(255, 0, -1):
        j = (j + key_stream[i % len(key_stream)]) % (i + 1)
        deck[i], deck[j] = deck[j], deck[i]

    cut_point = key_stream[0]
    deck = deck[cut_point:] + deck[:cut_point]

    half = len(deck) // 2
    left = deck[:half]
    right = deck[half:]
    shuffled = []
    for l, r in zip(left, right):
        shuffled.append(l)
        shuffled.append(r)
    deck = shuffled

    for i in range(256):
        swap_idx = (i + key_stream[i % len(key_stream)]) % 256
        deck[i], deck[swap_idx] = deck[swap_idx], deck[i]

    s_box = deck
    inv_s_box = [0] * 256
    for i, val in enumerate(s_box):
        inv_s_box[val] = i

    return s_box, inv_s_box


def generate_round_keys(master_key: str):
    keys = []
    current = master_key.encode()
    for _ in range(16):
        current = hashlib.sha256(current).digest()[:16]
        keys.append(current)
    return keys


def permute(block):
    return block[8:] + block[:8]


def inverse_permute(block):
    return permute(block)


def diffuse(block):
    result = bytearray(block)
    for i in range(1, len(result)):
        result[i] ^= result[i - 1]
    return bytes(result)


def inverse_diffuse(block):
    result = bytearray(block)
    for i in reversed(range(1, len(result))):
        result[i] ^= result[i - 1]
    return bytes(result)


def xor_blocks(a, b):
    return bytes([x ^ y for x, y in zip(a, b)])


def encrypt(plaintext: str, key: str):
    # S-BOX is derived from the same key — deterministic per chat pair
    s_box, _ = generate_cards_sbox(hashlib.sha256(key.encode()).digest())
    round_keys = generate_round_keys(key)

    blocks = [plaintext[i:i+16] for i in range(0, len(plaintext), 16)]
    encrypted_blocks = []

    for block_text in blocks:
        block = block_text.encode().ljust(16, b'\0')
        for i in range(16):
            block = bytes([s_box[b] for b in block])
            block = permute(block)
            block = diffuse(block)
            block = xor_blocks(block, round_keys[i])
        encrypted_blocks.append(block.hex())

    return "|".join(encrypted_blocks)


def decrypt(ciphertext: str, key: str):
    # S-BOX derived from same key — matches encrypt
    _, inv_s_box = generate_cards_sbox(hashlib.sha256(key.encode()).digest())
    round_keys = generate_round_keys(key)

    blocks = ciphertext.split("|")
    decrypted_text = ""

    for block_hex in blocks:
        if not block_hex:
            continue
        block = bytes.fromhex(block_hex)
        for i in reversed(range(16)):
            block = xor_blocks(block, round_keys[i])
            block = inverse_diffuse(block)
            block = inverse_permute(block)
            block = bytes([inv_s_box[b] for b in block])
        decrypted_text += block.decode(errors="ignore").rstrip('\x00')

    return decrypted_text