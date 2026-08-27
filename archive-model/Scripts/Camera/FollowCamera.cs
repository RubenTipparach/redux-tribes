using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class FollowCamera : MonoBehaviour
{
    Camera cam;

    Vector3 offset;

    // Start is called before the first frame update
    void Start()
    {
        cam = Camera.main;
        offset = transform.position - cam.transform.position;
    }

    // Update is called once per frame
    void Update()
    {
        transform.position = cam.transform.position + offset;
    }
}
