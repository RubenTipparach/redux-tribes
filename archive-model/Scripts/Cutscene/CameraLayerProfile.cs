using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class CameraLayerProfile : MonoBehaviour
{
    public LayerMask spaceLayers;
    public LayerMask internalLayers;
    public Camera assignedCamera;
    // Start is called before the first frame update
    void Start()
    {

    }

    // Update is called once per frame
    void Update()
    {

    }

    public void SwapToSpace()
    {
        assignedCamera.cullingMask = spaceLayers;
    }

    public void SwapToInterior()
    {
        assignedCamera.cullingMask = internalLayers;
    }
}
