using System.Collections;
using System.Collections.Generic;
using UnityEngine;


/// <summary>
/// The game input class. Used for driving mouse input for the camera.
/// </summary>
public class GameInput
{
    public Vector2 MouseDelta { get; set; }
    Vector2 lastMousePosition;

    public GameInput()
    {
        MouseDelta = Vector2.zero;
    }

    public bool GetTouchDown()
    {

#if UNITY_ANDROID && !UNITY_EDITOR
        return Input.touchCount > 1
            && Input.GetTouch(0).phase == TouchPhase.Moved 
            && Input.GetTouch(1).phase == TouchPhase.Moved;
#else
        return Input.GetMouseButtonDown(0);
#endif
    }

    public bool GetTouch()
    {

#if UNITY_ANDROID && !UNITY_EDITOR
        return Input.touchCount > 1
            && Input.GetTouch(0).phase == TouchPhase.Moved 
            && Input.GetTouch(1).phase == TouchPhase.Moved;
#else
        return Input.GetMouseButton(0);
#endif
    }

    public void UpdateInput()
    {
#if UNITY_ANDROID && !UNITY_EDITOR
        var t1 = (Input.GetTouch(0).deltaPosition + Input.GetTouch(1).deltaPosition) / 2;
        //var currentPosition = Input.mousePosition;
        mouseDelta = t1;//(Vector2)currentPosition - lastMousePosition;
        //lastMousePosition = Input.mousePosition;
#else
        var currentPosition = Input.mousePosition;
        MouseDelta = (Vector2)currentPosition - lastMousePosition;
        lastMousePosition = Input.mousePosition;
#endif
    }
}