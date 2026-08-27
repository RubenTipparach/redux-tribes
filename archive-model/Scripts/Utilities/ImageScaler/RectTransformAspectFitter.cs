using UnityEngine;
using UnityEngine.UI;
using UnityEngine.Video;
#if UNITY_EDITOR
using UnityEditor;
#endif

[ExecuteAlways]
public class RectTransformAspectFitter : MonoBehaviour
{
    public RectTransform targetRect;

    public RawImage rawImage;
    public VideoPlayer videoPlayer;

    void Awake()
    {
        rawImage = GetComponent<RawImage>();
        videoPlayer = GetComponent<VideoPlayer>();

        if (targetRect == null)
        {
            targetRect = GetComponent<RectTransform>();
        }
    }

    public void FitAspect()
    {
        Texture sourceTexture = null;
        rawImage = GetComponent<RawImage>();
        videoPlayer = GetComponent<VideoPlayer>();

        if (rawImage != null && rawImage.texture != null)
        {
            sourceTexture = rawImage.texture;
        }
        else if (videoPlayer != null && videoPlayer.targetTexture != null)
        {
            sourceTexture = videoPlayer.targetTexture;
        }

        if (targetRect == null || sourceTexture == null)
        {
            Debug.LogWarning("RectTransform or Source Texture is missing.");
            return;
        }


        float aspectRatio = (float)sourceTexture.width / sourceTexture.height;

        float width = targetRect.rect.width;
        float height = width / aspectRatio;

        targetRect.SetSizeWithCurrentAnchors(RectTransform.Axis.Vertical, height);
        Debug.Log($"new width={width} height={height}");

#if UNITY_EDITOR
        EditorUtility.SetDirty(targetRect);
#endif
    }
}
